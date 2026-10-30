import { createHash, randomBytes, randomInt } from 'node:crypto';
import { and, asc, desc, eq, ne, or } from 'drizzle-orm';
import {
  compareSemVer,
  parseExperienceVersionRef,
  type ComponentRegistry,
  type DeclaredContext,
  type EngineEvent,
  type LearnerAction,
  type SessionEvent,
} from '@dismodo/contracts';
import {
  buildReport,
  buildRuntime,
  editorialPolicy,
  handleAction,
  learnerView,
  replay,
  SessionActionError,
  startSession,
  type AdaptationPolicy,
  type PackageRuntime,
  type SessionState,
} from '@dismodo/engine';
import type { Database } from '../db/client';
import { learners, modelCalls, observations, packages, sessionEvents, sessions } from '../db/schema';
import { ApiError } from '../errors';
import { learnerHistory } from './history';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type SessionRow = typeof sessions.$inferSelect;
type PackageRow = typeof packages.$inferSelect;

export interface SessionServiceDeps {
  db: Database;
  registry: ComponentRegistry;
  /** Learner page base; the token is appended after "#" so it never reaches server logs. */
  sessionPageUrl: string;
  policies?: Partial<Record<'adaptive' | 'fixed', AdaptationPolicy>>;
  now?: () => Date;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Runtimes are pure functions of package content, so they are cached by content hash. */
const runtimeCache = new Map<string, PackageRuntime>();
function runtimeFor(
  registry: ComponentRegistry,
  row: Pick<PackageRow, 'contentHash' | 'content'>,
): PackageRuntime {
  let runtime = runtimeCache.get(row.contentHash);
  if (!runtime) {
    runtime = buildRuntime(row.content, registry);
    if (runtimeCache.size >= 100) runtimeCache.delete(runtimeCache.keys().next().value!);
    runtimeCache.set(row.contentHash, runtime);
  }
  return runtime;
}

function toSessionEvent(row: typeof sessionEvents.$inferSelect): SessionEvent {
  const at = row.createdAt.toISOString();
  return row.actor === 'learner'
    ? { seq: row.seq, at, actor: 'learner', action: row.payload as LearnerAction }
    : { seq: row.seq, at, actor: 'engine', event: row.payload as EngineEvent };
}

export function skillKey(runtime: PackageRuntime): string {
  return `${runtime.pkg.skill.id}|${runtime.activity.ref}`;
}

/** Every decision in a session, without model free text: who decided, with what, how fast, and why. */
export function decisionTrace(log: SessionEvent[]) {
  return log.flatMap((entry) => {
    if (entry.actor !== 'engine') return [];
    const e = entry.event;
    if (e.type !== 'intervention_started' && e.type !== 'decision_recorded') return [];
    const d = e.decision;
    return [
      {
        seq: entry.seq,
        at: entry.at,
        outcome: e.type === 'intervention_started' ? e.intervention : 'continue',
        source: d.source,
        hypothesis: d.hypothesis,
        rationale: d.source === 'model' ? null : d.rationale,
        escalation_reason: d.escalation_reason ?? null,
        fallback_reason: d.fallback_reason ?? null,
        model: d.model ?? null,
        attempts: (d.attempts ?? []).map(({ provider, model, tier, status, latency_ms }) => ({
          provider,
          model,
          tier,
          status,
          latency_ms,
        })),
      },
    ];
  });
}

/** Projects the model attempts carried by decision events into model_calls. */
async function recordModelCalls(
  tx: Tx,
  session: SessionRow,
  firstSeq: number,
  events: EngineEvent[],
  at: Date,
) {
  const rows = events.flatMap((event, i) => {
    if (event.type !== 'intervention_started' && event.type !== 'decision_recorded') return [];
    const decision = event.decision;
    return (decision.attempts ?? []).map((attempt, n) => ({
      sessionId: session.id,
      eventSeq: firstSeq + i,
      attempt: n + 1,
      tenantId: session.tenantId,
      provider: attempt.provider,
      model: attempt.model,
      tier: attempt.tier,
      status: attempt.status,
      latencyMs: Math.round(attempt.latency_ms),
      inputTokens: attempt.input_tokens,
      outputTokens: attempt.output_tokens,
      reasoningTokens: attempt.reasoning_tokens,
      error: attempt.error ?? null,
      decisionSource: decision.source,
      escalationReason: decision.escalation_reason ?? null,
      createdAt: at,
    }));
  });
  if (rows.length) await tx.insert(modelCalls).values(rows);
}

/** Words of a search query, lowercased; short words are dropped. */
export function searchTerms(query: string | undefined): string[] {
  return (query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/** Every term must appear in some field, allowing simple plurals ("quarters" finds "quarter"). */
export function matches(terms: string[], fields: string[]): boolean {
  const text = fields.join(' ').toLowerCase();
  return terms.every((term) =>
    [term, term.replace(/(es|s)$/, '')].some((form) => form.length >= 3 && text.includes(form)),
  );
}

export function createSessionService(deps: SessionServiceDeps) {
  const { db, registry } = deps;
  const now = deps.now ?? (() => new Date());
  const policyFor = (name: 'adaptive' | 'fixed') => deps.policies?.[name] ?? editorialPolicy;

  /** Resolves "id@version" or "id" (latest published) among packages this tenant may run. */
  async function resolvePackage(tenantId: string, experience: string): Promise<PackageRow> {
    const pinned = parseExperienceVersionRef(experience);
    const experienceId = pinned ? pinned.experienceId : experience;
    const rows = await db
      .select()
      .from(packages)
      .where(
        and(
          eq(packages.experienceId, experienceId),
          eq(packages.status, 'published'),
          or(eq(packages.tenantId, tenantId), eq(packages.visibility, 'public')),
        ),
      );
    // A tenant's own package shadows a public one with the same id.
    const own = rows.filter((r) => r.tenantId === tenantId);
    const candidates = own.length > 0 ? own : rows;
    const match = pinned
      ? candidates.find((r) => r.version === pinned.version)
      : candidates.sort((a, b) => compareSemVer(b.version, a.version))[0];
    if (!match) {
      throw new ApiError(
        404,
        'experience_not_found',
        `No published experience "${experience}" is available to you.`,
      );
    }
    return match;
  }

  async function ensureLearner(tx: Tx | Database, tenantId: string, externalRef: string) {
    await tx.insert(learners).values({ tenantId, externalRef }).onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(learners)
      .where(and(eq(learners.tenantId, tenantId), eq(learners.externalRef, externalRef)));
    return row!;
  }

  /** Identities this learner met in other sessions of the same skill (same tenant only). */
  async function seenIdentities(
    tx: Tx | Database,
    session: Pick<SessionRow, 'id' | 'tenantId' | 'learnerId' | 'skillKey'>,
  ) {
    const rows = await tx
      .selectDistinct({ identity: observations.identity })
      .from(observations)
      .where(
        and(
          eq(observations.tenantId, session.tenantId),
          eq(observations.learnerId, session.learnerId),
          eq(observations.skillKey, session.skillKey),
          ne(observations.sessionId, session.id),
        ),
      );
    return rows.map((r) => r.identity);
  }

  async function syncObservations(tx: Tx, session: SessionRow, state: SessionState) {
    // Every presented problem counts as exposure for memory, answered or not.
    const rows = state.items
      .filter((item) => !item.replaced_by || item.unfamiliar)
      .map((item) => ({
        sessionId: session.id,
        itemId: item.item_id,
        tenantId: session.tenantId,
        learnerId: session.learnerId,
        skillKey: session.skillKey,
        experienceRef: session.experienceRef,
        engineVersion: state.engine_version,
        phase: item.phase,
        identity: item.identity,
        contextId: item.context_id,
        correct: item.answer && !item.replaced_by ? item.answer.correct : null,
        errorCode: item.answer?.error_code ?? null,
        alternativeCodes: item.answer?.alternative_codes ?? [],
        hintsUsed: item.hints.length,
        selfRating: item.self_rating ?? null,
        unfamiliarReference: item.unfamiliar,
        interventionsBefore: state.interventions
          .filter((i) => i.seq < item.presented_seq)
          .map((i) => i.intervention),
        observedAt: new Date(item.answer?.at ?? item.presented_at),
      }));
    await tx.delete(observations).where(eq(observations.sessionId, session.id));
    if (rows.length) await tx.insert(observations).values(rows);
  }

  async function loadLog(tx: Tx | Database, sessionId: string): Promise<SessionEvent[]> {
    const rows = await tx
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId))
      .orderBy(asc(sessionEvents.seq));
    return rows.map(toSessionEvent);
  }

  async function packageOf(tx: Tx | Database, session: SessionRow) {
    const [row] = await tx.select().from(packages).where(eq(packages.id, session.packageId));
    return runtimeFor(registry, row!);
  }

  function describe(session: SessionRow, token?: string) {
    return {
      session_id: session.id,
      experience_ref: session.experienceRef,
      status: session.status,
      phase: session.phase,
      policy: session.policy,
      expires_at: session.expiresAt.toISOString(),
      created_at: session.createdAt.toISOString(),
      completed_at: session.completedAt?.toISOString() ?? null,
      ...(token ? { url: `${deps.sessionPageUrl}#${token}` } : {}),
    };
  }

  /** Earlier submission with the same client_event_id, answered with the current view. */
  async function findDuplicate(
    tx: Tx | Database,
    session: SessionRow,
    runtime: PackageRuntime,
    clientEventId: string,
  ) {
    const [dup] = await tx
      .select({ seq: sessionEvents.seq })
      .from(sessionEvents)
      .where(and(eq(sessionEvents.sessionId, session.id), eq(sessionEvents.clientEventId, clientEventId)));
    if (!dup) return null;
    const state = replay(await loadLog(tx, session.id));
    return {
      duplicate: true,
      accepted_seq: dup.seq,
      session: describe(session),
      view: learnerView({ runtime }, state),
    };
  }

  return {
    resolvePackage,

    async create(input: {
      tenantId: string;
      experience: string;
      learnerRef: string;
      declared: DeclaredContext;
      policy: 'adaptive' | 'fixed';
    }) {
      const pkgRow = await resolvePackage(input.tenantId, input.experience);
      const runtime = runtimeFor(registry, pkgRow);
      const unknownContexts = (input.declared.familiar_contexts ?? []).filter(
        (id) => !runtime.contexts.has(id),
      );
      if (unknownContexts.length) {
        throw new ApiError(400, 'unknown_context', `Unknown context(s): ${unknownContexts.join(', ')}.`, {
          available: [...runtime.contexts.keys()],
        });
      }
      const token = randomBytes(32).toString('base64url');
      const createdAt = now();
      const experienceRef = `${pkgRow.experienceId}@${pkgRow.version}`;
      return db.transaction(async (tx) => {
        const learner = await ensureLearner(tx, input.tenantId, input.learnerRef);
        const [session] = await tx
          .insert(sessions)
          .values({
            tenantId: input.tenantId,
            learnerId: learner.id,
            packageId: pkgRow.id,
            experienceRef,
            contentHash: pkgRow.contentHash,
            skillKey: skillKey(runtime),
            policy: input.policy,
            seed: randomInt(0, 2 ** 31 - 1),
            phase: 'baseline',
            lastSeq: 0,
            tokenHash: hashToken(token),
            expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS),
          })
          .returning();
        const seen = await seenIdentities(tx, session!);
        const history = await learnerHistory(
          tx,
          {
            tenantId: input.tenantId,
            learnerId: learner.id,
            skillKey: session!.skillKey,
            excludeSessionId: session!.id,
          },
          createdAt,
        );
        const events = startSession(
          { runtime, policy: policyFor(input.policy), now: createdAt, seenIdentities: seen, history },
          {
            experienceRef,
            contentHash: pkgRow.contentHash,
            policy: input.policy,
            seed: session!.seed,
            declared: input.declared,
          },
        );
        await tx.insert(sessionEvents).values(
          events.map((event, i) => ({
            sessionId: session!.id,
            seq: i + 1,
            actor: 'engine',
            type: event.type,
            payload: event,
            createdAt,
          })),
        );
        const state = replay(
          events.map((event, i) => ({ seq: i + 1, at: createdAt.toISOString(), actor: 'engine', event })),
        );
        const [updated] = await tx
          .update(sessions)
          .set({ phase: state.phase, lastSeq: events.length, updatedAt: createdAt })
          .where(eq(sessions.id, session!.id))
          .returning();
        await syncObservations(tx, updated!, state);
        return { session: describe(updated!, token), view: learnerView({ runtime }, state) };
      });
    },

    /** Recent sessions of a tenant, newest first, with the learner's external ref. */
    async list(
      tenantId: string,
      filter: { limit: number; experienceId?: string; policy?: 'adaptive' | 'fixed' },
    ) {
      const rows = await db
        .select({ session: sessions, learnerRef: learners.externalRef })
        .from(sessions)
        .innerJoin(learners, eq(learners.id, sessions.learnerId))
        .where(
          and(
            eq(sessions.tenantId, tenantId),
            ...(filter.policy ? [eq(sessions.policy, filter.policy)] : []),
          ),
        )
        .orderBy(desc(sessions.createdAt))
        .limit(filter.limit);
      return rows
        .filter((r) => !filter.experienceId || r.session.experienceRef.startsWith(`${filter.experienceId}@`))
        .map((r) => ({ ...describe(r.session), learner_ref: r.learnerRef }));
    },

    async findForTenant(tenantId: string, sessionId: string) {
      const [row] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, tenantId)));
      if (!row) throw new ApiError(404, 'not_found', 'No such session for this API key.');
      return row;
    },

    async findByToken(token: string) {
      const [row] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, hashToken(token)));
      if (!row) throw new ApiError(401, 'invalid_session_token', 'This session link is not valid.');
      if (row.expiresAt.getTime() < now().getTime()) {
        throw new ApiError(410, 'session_expired', 'This session link has expired.');
      }
      return row;
    },

    /** Applies a learner action atomically: lock, replay, validate, append, project. */
    /**
     * Applies a learner action. The engine (and any model it consults) runs without holding a lock; the
     * result is then committed under a row lock only if the session did not change meanwhile, otherwise it
     * is recomputed. A slow model therefore never blocks the database or other requests.
     */
    async submit(sessionId: string, action: LearnerAction, clientEventId?: string) {
      for (let round = 0; round < 3; round++) {
        const [snapshot] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
        if (!snapshot) throw new ApiError(404, 'not_found', 'No such session.');
        const runtime = await packageOf(db, snapshot);
        const duplicate = clientEventId ? await findDuplicate(db, snapshot, runtime, clientEventId) : null;
        if (duplicate) return duplicate;
        const log = await loadLog(db, snapshot.id);
        if ((log.at(-1)?.seq ?? 0) !== snapshot.lastSeq) continue; // a write landed between the two reads
        const at = now();
        let result: Awaited<ReturnType<typeof handleAction>>;
        try {
          result = await handleAction(
            {
              runtime,
              policy: policyFor(snapshot.policy),
              now: at,
              seenIdentities: await seenIdentities(db, snapshot),
              history: await learnerHistory(
                db,
                {
                  tenantId: snapshot.tenantId,
                  learnerId: snapshot.learnerId,
                  skillKey: snapshot.skillKey,
                  excludeSessionId: snapshot.id,
                },
                at,
              ),
            },
            log,
            action,
          );
        } catch (error) {
          if (error instanceof SessionActionError)
            throw new ApiError(error.statusCode, error.code, error.message);
          throw error;
        }

        const committed = await db.transaction(async (tx) => {
          const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for('update');
          if (clientEventId) {
            const dup = await findDuplicate(tx, session!, runtime, clientEventId);
            if (dup) return dup;
          }
          if (session!.lastSeq !== snapshot.lastSeq) return null; // stale: recompute on the fresh log
          const learnerSeq = session!.lastSeq + 1;
          await tx.insert(sessionEvents).values([
            {
              sessionId: session!.id,
              seq: learnerSeq,
              actor: 'learner',
              type: action.type,
              payload: action,
              clientEventId: clientEventId ?? null,
              createdAt: at,
            },
            ...result.events.map((event, i) => ({
              sessionId: session!.id,
              seq: learnerSeq + 1 + i,
              actor: 'engine',
              type: event.type,
              payload: event,
              createdAt: at,
            })),
          ]);
          await recordModelCalls(tx, session!, learnerSeq + 1, result.events, at);
          const state = result.state;
          const [updated] = await tx
            .update(sessions)
            .set({
              status: state.status,
              phase: state.phase,
              lastSeq: learnerSeq + result.events.length,
              updatedAt: at,
              completedAt: state.completed_at ? new Date(state.completed_at) : null,
            })
            .where(eq(sessions.id, session!.id))
            .returning();
          await syncObservations(tx, updated!, state);
          return {
            duplicate: false,
            accepted_seq: learnerSeq,
            session: describe(updated!),
            view: learnerView({ runtime }, state),
          };
        });
        if (committed) return committed;
      }
      throw new ApiError(
        409,
        'session_busy',
        'The session kept changing while this action was processed; retry.',
      );
    },

    async view(session: SessionRow) {
      const runtime = await packageOf(db, session);
      const state = replay(await loadLog(db, session.id));
      // Status and phase come from the same replay as the view, so a concurrent write cannot split them.
      return {
        session: {
          ...describe(session),
          status: state.status,
          phase: state.phase,
          completed_at: state.completed_at,
        },
        view: learnerView({ runtime }, state),
      };
    },

    async report(session: SessionRow) {
      const runtime = await packageOf(db, session);
      const report = buildReport(
        replay(await loadLog(db, session.id)),
        runtime.pkg.session_policy.independent_items,
      );
      return { session_id: session.id, ...report };
    },

    /**
     * The report as a learner (or the public playground) may see it: the model's free-text readings are
     * builder-only, so they are left out; reviewed hypotheses and observed facts stay.
     */
    async learnerReport(session: SessionRow) {
      const full = await this.report(session);
      return {
        ...full,
        statements: {
          ...full.statements,
          interpretation: full.statements.interpretation.filter((s) => s.source !== 'model'),
        },
        decisions: decisionTrace(await loadLog(db, session.id)),
      };
    },

    async events(session: SessionRow) {
      return loadLog(db, session.id);
    },

    /** Published experiences a tenant can start: its own and public ones. */
    async listExperiences(tenantId: string, query?: string) {
      const rows = await db
        .select()
        .from(packages)
        .where(
          and(
            eq(packages.status, 'published'),
            or(eq(packages.tenantId, tenantId), eq(packages.visibility, 'public')),
          ),
        );
      const latest = new Map<string, PackageRow>();
      for (const row of rows) {
        const key = `${row.tenantId === tenantId ? 'own' : 'public'}:${row.experienceId}`;
        const current = latest.get(key);
        if (!current || compareSemVer(row.version, current.version) > 0) latest.set(key, row);
      }
      const terms = searchTerms(query);
      return [...latest.values()]
        .map((row) => {
          const runtime = runtimeFor(registry, row);
          const pkg = runtime.pkg;
          return {
            experience_ref: `${row.experienceId}@${row.version}`,
            experience_id: row.experienceId,
            version: row.version,
            owner: row.tenantId === tenantId ? 'own' : 'public',
            title: pkg.title,
            objective: pkg.objective,
            summary: pkg.summary,
            locale: pkg.locale,
            audience: pkg.audience.description,
            skill: pkg.skill,
            prerequisites: pkg.prerequisites.map((p) => p.text),
            contexts: pkg.contexts.map((c) => ({ id: c.id, label: c.label })),
            time_budget_minutes: pkg.session_policy.time_budget_minutes,
            activity: row.activityRevision,
          };
        })
        .filter((e) => matches(terms, [e.title, e.objective, e.summary, e.skill.name, e.experience_id]))
        .sort((a, b) => a.experience_id.localeCompare(b.experience_id));
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
