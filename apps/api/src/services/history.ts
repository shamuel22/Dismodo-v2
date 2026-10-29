import { and, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';
import type { InterventionId } from '@dismodo/contracts';
import type { LearnerHistory } from '@dismodo/engine';
import type { Database } from '../db/client';
import { historyResets, observations, sessions } from '../db/schema';

/** Memory is deliberately short: recent sessions of the same skill only. */
export const HISTORY_SESSIONS = 5;
export const HISTORY_DAYS = 90;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function lastReset(db: Database | Tx, tenantId: string, learnerId: string, skillKey: string) {
  const [row] = await db
    .select({ at: historyResets.createdAt })
    .from(historyResets)
    .where(
      and(
        eq(historyResets.tenantId, tenantId),
        eq(historyResets.learnerId, learnerId),
        or(isNull(historyResets.skillKey), eq(historyResets.skillKey, skillKey)),
      ),
    )
    .orderBy(desc(historyResets.createdAt))
    .limit(1);
  return row?.at ?? null;
}

/**
 * Summarises earlier sessions of one learner and skill within one tenant. Never crosses tenants or skills,
 * ignores evidence older than the window or than the learner's latest reset.
 */
export async function learnerHistory(
  db: Database | Tx,
  scope: { tenantId: string; learnerId: string; skillKey: string; excludeSessionId?: string },
  now = new Date(),
): Promise<LearnerHistory> {
  const reset = await lastReset(db, scope.tenantId, scope.learnerId, scope.skillKey);
  const windowStart = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const since = reset && reset > windowStart ? reset : windowStart;
  const recent = await db
    .select({ id: sessions.id, createdAt: sessions.createdAt })
    .from(sessions)
    .where(
      and(
        eq(sessions.tenantId, scope.tenantId),
        eq(sessions.learnerId, scope.learnerId),
        eq(sessions.skillKey, scope.skillKey),
        gt(sessions.createdAt, since),
        ...(scope.excludeSessionId ? [ne(sessions.id, scope.excludeSessionId)] : []),
      ),
    )
    .orderBy(desc(sessions.createdAt))
    .limit(HISTORY_SESSIONS);
  if (recent.length === 0)
    return { sessions: 0, interventions: [], unfamiliar_contexts: [], last_independent: null };

  const rows = await db
    .select()
    .from(observations)
    .where(
      inArray(
        observations.sessionId,
        recent.map((r) => r.id),
      ),
    );
  const bySession = new Map<string, typeof rows>();
  for (const row of rows) bySession.set(row.sessionId, [...(bySession.get(row.sessionId) ?? []), row]);

  const outcomes = new Map<InterventionId, { followed_by_correct: number; total: number }>();
  const unfamiliar = new Set<string>();
  for (const sessionRows of bySession.values()) {
    const ordered = sessionRows.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
    let seen: string[] = [];
    for (const row of ordered) {
      if (row.unfamiliarReference) unfamiliar.add(row.contextId);
      if (row.correct === null) continue;
      // Interventions shown since the previous answered item are the ones this answer followed.
      const fresh = row.interventionsBefore.slice(seen.length) as InterventionId[];
      seen = row.interventionsBefore;
      for (const intervention of fresh) {
        const entry = outcomes.get(intervention) ?? { followed_by_correct: 0, total: 0 };
        entry.total++;
        if (row.correct) entry.followed_by_correct++;
        outcomes.set(intervention, entry);
      }
    }
  }
  const latest = bySession.get(recent[0]!.id) ?? [];
  const independent = latest.filter((r) => r.phase === 'independent' && r.correct !== null);
  return {
    sessions: recent.length,
    interventions: [...outcomes].map(([intervention, o]) => ({ intervention, ...o })),
    unfamiliar_contexts: [...unfamiliar],
    last_independent: independent.length
      ? { correct: independent.filter((r) => r.correct).length, attempted: independent.length }
      : null,
  };
}
