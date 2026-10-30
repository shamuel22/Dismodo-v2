import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createClient,
  DismodoApiError,
  type DecisionMetrics,
  type DismodoClient,
  type ListedSession,
  type SessionEvent,
  type SessionEvidence,
} from '@dismodo/sdk';

const KEY_STORAGE = 'dismodo.console-key';

function readKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

/**
 * Builder console: sessions, their evidence and full decision traces, and how decision models and routes
 * behave for your product. Uses your API key from this tab only (a read-only evidence key is enough).
 */
export function ConsolePage() {
  const [key, setKey] = useState(readKey);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const client = useMemo(
    () => (key ? createClient({ baseUrl: window.location.origin, apiKey: key }) : null),
    [key],
  );

  useEffect(() => {
    document.title = 'Console · DISMODO';
  }, []);

  const connect = async (candidate: string) => {
    setError(null);
    try {
      await createClient({ baseUrl: window.location.origin, apiKey: candidate }).metrics.decisions();
      try {
        sessionStorage.setItem(KEY_STORAGE, candidate);
      } catch {
        // Storage unavailable: the key lives in memory for this page only.
      }
      setKey(candidate);
    } catch (e) {
      setError(
        e instanceof DismodoApiError && e.status === 403
          ? 'This key lacks the evidence:read scope.'
          : e instanceof DismodoApiError
            ? e.message
            : 'Could not reach the API.',
      );
    }
  };

  if (!client) {
    return (
      <article className="doc">
        <h1>Console</h1>
        <p>
          See your product's sessions, the evidence each one produced, every decision the engine made and how
          the decision models perform. Use a key with the <code>evidence:read</code> scope; it is kept only in
          this browser tab.
        </p>
        <form
          className="playground__form"
          onSubmit={(e) => {
            e.preventDefault();
            void connect(draft.trim());
          }}
        >
          <label className="field">
            <span className="field__label">API key</span>
            <input
              className="field__input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="dsm_..."
            />
            <span className="field__help">
              Create one with: pnpm tenant:create --slug your-product --name "Your product" --scopes
              evidence:read
            </span>
          </label>
          <div>
            <button className="button button--primary" type="submit" disabled={!draft.trim()}>
              Open console
            </button>
          </div>
          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}
        </form>
      </article>
    );
  }

  return (
    <Console
      client={client}
      onSignOut={() => {
        try {
          sessionStorage.removeItem(KEY_STORAGE);
        } catch {
          // nothing stored
        }
        setKey('');
      }}
    />
  );
}

function Console({ client, onSignOut }: { client: DismodoClient; onSignOut: () => void }) {
  const [sessions, setSessions] = useState<ListedSession[] | null>(null);
  const [metrics, setMetrics] = useState<DecisionMetrics | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(() => {
    client.sessions.list({ limit: 50 }).then(
      (r) => setSessions(r.sessions),
      () => setSessions([]),
    );
    client.metrics.decisions().then(setMetrics, () => setMetrics(null));
  }, [client]);
  useEffect(load, [load]);

  return (
    <div className="console">
      <div className="console__bar">
        <h1 className="console__title">Console</h1>
        <button className="button button--text" onClick={load}>
          Refresh
        </button>
        <button className="button button--text" onClick={onSignOut}>
          Forget key
        </button>
      </div>

      {selected ? (
        <SessionDetail client={client} sessionId={selected} onBack={() => setSelected(null)} />
      ) : (
        <>
          <section aria-labelledby="sessions-title">
            <h2 id="sessions-title" className="console__h2">
              Recent sessions
            </h2>
            {!sessions ? (
              <p className="console__muted">Loading…</p>
            ) : sessions.length === 0 ? (
              <p className="console__muted">No sessions yet.</p>
            ) : (
              <div className="console__table-wrap">
                <table className="console__table">
                  <thead>
                    <tr>
                      <th>Learner</th>
                      <th>Experience</th>
                      <th>Route</th>
                      <th>Status</th>
                      <th>Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.session_id}>
                        <td>
                          <button className="console__link" onClick={() => setSelected(s.session_id)}>
                            {s.learner_ref}
                          </button>
                        </td>
                        <td>{s.experience_ref}</td>
                        <td>{s.policy}</td>
                        <td>{s.status}</td>
                        <td>{new Date(s.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {metrics && <Metrics metrics={metrics} />}
        </>
      )}
    </div>
  );
}

function Metrics({ metrics }: { metrics: DecisionMetrics }) {
  return (
    <>
      <section aria-labelledby="models-title">
        <h2 id="models-title" className="console__h2">
          Decision models
        </h2>
        {metrics.models.length === 0 ? (
          <p className="console__muted">No model calls yet.</p>
        ) : (
          <div className="console__table-wrap">
            <table className="console__table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Tier</th>
                  <th>Calls</th>
                  <th>OK</th>
                  <th>p50</th>
                  <th>p95</th>
                  <th>Tokens in / out</th>
                  <th>Failures</th>
                </tr>
              </thead>
              <tbody>
                {metrics.models.map((m) => (
                  <tr key={`${m.provider}/${m.model}/${m.tier}`}>
                    <td>
                      {m.model} <span className="console__muted">({m.provider})</span>
                    </td>
                    <td>{m.tier}</td>
                    <td>{m.calls}</td>
                    <td>{m.ok}</td>
                    <td>{seconds(m.p50_latency_ms)}</td>
                    <td>{seconds(m.p95_latency_ms)}</td>
                    <td>
                      {m.input_tokens} / {m.output_tokens}
                    </td>
                    <td>
                      {Object.entries(m.failures ?? {})
                        .map(([status, n]) => `${status} ${n}`)
                        .join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section aria-labelledby="routes-title">
        <h2 id="routes-title" className="console__h2">
          Adaptive and fixed routes
        </h2>
        <div className="console__table-wrap">
          <table className="console__table">
            <thead>
              <tr>
                <th>Route</th>
                <th>Sessions</th>
                <th>Completed</th>
                <th>Practice correct</th>
                <th>Hints</th>
                <th>New problems correct (no hints)</th>
              </tr>
            </thead>
            <tbody>
              {metrics.routes.map((r) => (
                <tr key={r.policy}>
                  <td>{r.policy}</td>
                  <td>{r.sessions}</td>
                  <td>{r.completed}</td>
                  <td>
                    {r.practice_correct} / {r.practice_attempted}
                  </td>
                  <td>{r.practice_hints}</td>
                  <td>
                    {r.independent_correct} / {r.independent_attempted}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="console__muted">{metrics.note}</p>
      </section>
    </>
  );
}

function SessionDetail({
  client,
  sessionId,
  onBack,
}: {
  client: DismodoClient;
  sessionId: string;
  onBack: () => void;
}) {
  const [report, setReport] = useState<SessionEvidence | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  useEffect(() => {
    client.sessions.evidence(sessionId).then(setReport, () => setReport(null));
    client.sessions.events(sessionId).then(
      (r) => setEvents(r.events),
      () => setEvents([]),
    );
  }, [client, sessionId]);

  const decisions = events.flatMap((e) =>
    e.actor === 'engine' && (e.event.type === 'intervention_started' || e.event.type === 'decision_recorded')
      ? [{ seq: e.seq, at: e.at, event: e.event }]
      : [],
  );

  return (
    <div>
      <button className="button button--text console__back" onClick={onBack}>
        ← All sessions
      </button>
      {!report ? (
        <p className="console__muted">Loading…</p>
      ) : (
        <>
          <h2 className="console__h2">
            {report.experience_ref} · {report.policy} · {report.status}
          </h2>
          <div className="console__grid">
            <Statements title="Observed" items={report.statements.observed} />
            <Statements
              title="Interpretation"
              items={report.statements.interpretation.map((i) => `${i.text} [${i.source}]`)}
            />
            <Statements title="The learner said" items={report.statements.learner_view} />
            <Statements title="Not yet checked" items={report.statements.not_yet_checked} />
          </div>
          {report.history && (
            <Statements
              title={`Shaped by ${report.history.sessions} earlier session(s)`}
              items={report.history.effects}
            />
          )}

          <h3 className="console__h3">Decisions</h3>
          {decisions.length === 0 ? (
            <p className="console__muted">No decisions were needed in this session.</p>
          ) : (
            <ol className="trace__list">
              {decisions.map(({ seq, event }) => {
                const d = event.decision;
                return (
                  <li key={seq} className="trace__item">
                    <p className="trace__head">
                      <span className="trace__outcome">
                        #{seq} {event.type === 'intervention_started' ? event.intervention : 'continue'}
                      </span>
                      <span className={`trace__source trace__source--${d.source}`}>{d.source}</span>
                    </p>
                    {d.hypothesis && (
                      <p className="trace__text">Hypothesis (shown to learner): {d.hypothesis}</p>
                    )}
                    {d.model_interpretation && (
                      <p className="trace__text">Model reading (builder only): {d.model_interpretation}</p>
                    )}
                    <p className="trace__text">Rationale: {d.rationale}</p>
                    {d.escalation_reason && <p className="trace__note">Escalated: {d.escalation_reason}</p>}
                    {d.fallback_reason && <p className="trace__note">Fallback: {d.fallback_reason}</p>}
                    {(d.attempts ?? []).length > 0 && (
                      <p className="trace__meta">
                        {(d.attempts ?? [])
                          .map(
                            (a) =>
                              `${a.tier}/${a.model} ${a.status} ${(a.latency_ms / 1000).toFixed(1)} s` +
                              (a.input_tokens !== null ? ` · ${a.input_tokens}→${a.output_tokens} tok` : ''),
                          )
                          .join(' → ')}
                      </p>
                    )}
                    <p className="trace__meta">Evidence: events {d.evidence_seqs.join(', ') || '—'}</p>
                  </li>
                );
              })}
            </ol>
          )}

          <h3 className="console__h3">Event log</h3>
          <ol className="console__events">
            {events.map((e) => (
              <li key={e.seq}>
                <span className="console__seq">{e.seq}</span>
                <span className={`console__actor console__actor--${e.actor}`}>{e.actor}</span>
                <span className="console__type">{e.actor === 'learner' ? e.action.type : e.event.type}</span>
                <span className="console__detail">{describeEvent(e)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`);

function Statements({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="console__card">
      <p className="trace__label">{title}</p>
      {items.length ? (
        <ul>
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="console__muted">—</p>
      )}
    </div>
  );
}

function describeEvent(e: SessionEvent): string {
  if (e.actor === 'learner') {
    const a = e.action;
    if (a.type === 'answer') return `${a.item_id}`;
    if (a.type === 'self_rating') return `${a.item_id}: ${a.rating}`;
    if (a.type === 'hypothesis_feedback')
      return `${a.agrees ? 'agrees' : 'disagrees'}${a.note ? `: "${a.note}"` : ''}`;
    if ('item_id' in a) return a.item_id;
    return '';
  }
  const ev = e.event;
  switch (ev.type) {
    case 'item_presented':
      return `${ev.item_id} · ${ev.phase} · ${ev.context_id} · ${ev.prompt}`;
    case 'evaluated':
      return `${ev.item_id} · ${ev.correct ? 'correct' : `not correct (${ev.error_code}${ev.alternative_codes.length ? ` ~ ${ev.alternative_codes.join(', ')}` : ''})`}`;
    case 'hint_given':
      return `${ev.item_id} · hint ${ev.level}`;
    case 'phase_changed':
      return `${ev.from} → ${ev.to} (${ev.reason})`;
    case 'status_changed':
      return `${ev.to} (${ev.reason})`;
    case 'context_changed':
      return `${ev.from} → ${ev.to}`;
    case 'intervention_started':
      return `${ev.intervention} · ${ev.decision.source}`;
    case 'decision_recorded':
      return `continue · ${ev.decision.source}`;
    case 'history_applied':
      return ev.effects.join(' ');
    case 'session_started':
      return `${ev.experience_ref} · ${ev.policy} · engine ${ev.engine_version}`;
  }
}
