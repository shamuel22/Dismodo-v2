import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createRuntimeClient,
  startPlaygroundSession,
  tokenFromSessionUrl,
  type DecisionTraceEntry,
  type LearnerEvidence,
} from '@dismodo/sdk';
import { SessionPage } from '../session/SessionPage';

interface PlaygroundExperience {
  experience_ref: string;
  experience_id: string;
  title: string;
  objective: string;
  contexts: { id: string; label: string }[];
}

const LEARNER_KEY = 'dismodo.playground-learner';

function storedLearner(): string | undefined {
  try {
    return localStorage.getItem(LEARNER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The reference client: start a real session on a public experience, work through it, and watch every
 * decision the engine makes. No key needed; data stays in the isolated playground tenant.
 */
export function PlaygroundPage() {
  const [experiences, setExperiences] = useState<PlaygroundExperience[]>([]);
  const [experienceId, setExperienceId] = useState('');
  const [familiar, setFamiliar] = useState<string[]>([]);
  const [policy, setPolicy] = useState<'adaptive' | 'fixed'>('adaptive');
  const [remember, setRemember] = useState(() => !!storedLearner());
  const [session, setSession] = useState<{ url: string; token: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Playground · DISMODO';
    fetch('/v1/playground/experiences')
      .then((r) => r.json())
      .then((data: { experiences: PlaygroundExperience[] }) => {
        setExperiences(data.experiences);
        setExperienceId(data.experiences[0]?.experience_id ?? '');
      })
      .catch(() => setError('Could not load experiences. Is the API running?'));
  }, []);

  const experience = experiences.find((e) => e.experience_id === experienceId);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await startPlaygroundSession(window.location.origin, {
        experience: experienceId,
        declared: familiar.length ? { familiar_contexts: familiar } : {},
        policy,
        ...(remember && storedLearner() ? { learnerRef: storedLearner() } : {}),
      });
      try {
        if (remember) localStorage.setItem(LEARNER_KEY, res.learner_ref);
        else localStorage.removeItem(LEARNER_KEY);
      } catch {
        // Storage unavailable: memory across sessions simply does not apply.
      }
      setSession({ url: res.session.url, token: tokenFromSessionUrl(res.session.url)! });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  if (session) {
    return <PlaygroundSession session={session} onRestart={() => setSession(null)} />;
  }

  return (
    <article className="doc playground">
      <h1>Playground</h1>
      <p>
        Start a real session on a public experience. You act as the learner; next to the activity you can see
        every decision the engine makes. Nothing you do here is linked to you.
      </p>

      <form
        className="playground__form"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <label className="field">
          <span className="field__label">Experience</span>
          <select
            value={experienceId}
            onChange={(e) => {
              setExperienceId(e.target.value);
              setFamiliar([]);
            }}
          >
            {experiences.map((e) => (
              <option key={e.experience_ref} value={e.experience_id}>
                {e.title} ({e.experience_ref})
              </option>
            ))}
          </select>
          {experience && <span className="field__help">{experience.objective}</span>}
        </label>

        {experience && (
          <fieldset className="field">
            <legend className="field__label">References the learner knows (optional)</legend>
            <div className="field__choices">
              {experience.contexts.map((c) => (
                <label key={c.id} className="choice">
                  <input
                    type="checkbox"
                    checked={familiar.includes(c.id)}
                    onChange={(e) =>
                      setFamiliar((f) => (e.target.checked ? [...f, c.id] : f.filter((id) => id !== c.id)))
                    }
                  />
                  {c.label}
                </label>
              ))}
            </div>
            <span className="field__help">Checked references come first. Unchecked ones are still used.</span>
          </fieldset>
        )}

        <fieldset className="field">
          <legend className="field__label">Route</legend>
          <div className="field__choices">
            <label className="choice">
              <input
                type="radio"
                name="policy"
                checked={policy === 'adaptive'}
                onChange={() => setPolicy('adaptive')}
              />
              Adaptive (Muse Spark, Muse Wonder for harder moments)
            </label>
            <label className="choice">
              <input
                type="radio"
                name="policy"
                checked={policy === 'fixed'}
                onChange={() => setPolicy('fixed')}
              />
              Fixed editorial route (comparison)
            </label>
          </div>
        </fieldset>

        <label className="choice">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember me in this browser, so earlier sessions can inform the next one
        </label>

        <div>
          <button className="button button--primary" type="submit" disabled={!experienceId || starting}>
            {starting ? 'Starting…' : 'Start session'}
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

function PlaygroundSession({
  session,
  onRestart,
}: {
  session: { url: string; token: string };
  onRestart: () => void;
}) {
  const client = useMemo(
    () => createRuntimeClient({ baseUrl: window.location.origin, sessionToken: session.token }),
    [session.token],
  );
  const [evidence, setEvidence] = useState<LearnerEvidence | null>(null);
  const refresh = useCallback(() => {
    client.evidence().then(setEvidence, () => undefined);
  }, [client]);

  return (
    <div className="playground__live">
      <div className="playground__session">
        <SessionPage token={session.token} embedded onChange={refresh} />
        <p className="playground__links">
          <a href={session.url} target="_blank" rel="noreferrer">
            Open as a learner link
          </a>
          <button className="button button--text" onClick={onRestart}>
            Start another session
          </button>
        </p>
      </div>
      <aside className="playground__trace" aria-label="Engine decisions">
        <h2 className="playground__trace-title">What the engine decided</h2>
        {evidence?.history && (
          <div className="trace__history">
            <p className="trace__label">From earlier sessions ({evidence.history.sessions})</p>
            <ul>
              {evidence.history.effects.map((effect) => (
                <li key={effect}>{effect}</li>
              ))}
            </ul>
          </div>
        )}
        {!evidence || evidence.decisions.length === 0 ? (
          <p className="trace__empty">
            Decisions appear here after answers that call for one. Try a wrong answer, mark that you were not
            sure, or say you don't know an example.
          </p>
        ) : (
          <ol className="trace__list">
            {[...evidence.decisions].reverse().map((d) => (
              <DecisionItem key={d.seq} decision={d} />
            ))}
          </ol>
        )}
        {evidence && evidence.statements.observed.length > 0 && (
          <div className="trace__observed">
            <p className="trace__label">Observed so far</p>
            <ul>
              {evidence.statements.observed.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

const SOURCE_LABEL: Record<DecisionTraceEntry['source'], string> = {
  model: 'Model',
  editorial: 'Editorial route',
  rules: 'Engine rule',
  fallback: 'Fallback',
};

function DecisionItem({ decision: d }: { decision: DecisionTraceEntry }) {
  return (
    <li className="trace__item">
      <p className="trace__head">
        <span className="trace__outcome">{d.outcome === 'continue' ? 'Continue' : d.outcome}</span>
        <span className={`trace__source trace__source--${d.source}`}>{SOURCE_LABEL[d.source]}</span>
      </p>
      {d.model && (
        <p className="trace__meta">
          {d.model.model} · {d.model.tier} · {(d.model.latency_ms / 1000).toFixed(1)} s
        </p>
      )}
      {d.hypothesis && <p className="trace__text">Hypothesis: {d.hypothesis}</p>}
      {d.rationale && <p className="trace__text">{d.rationale}</p>}
      {d.escalation_reason && <p className="trace__note">Escalated: {d.escalation_reason}</p>}
      {d.fallback_reason && <p className="trace__note">Fallback: {d.fallback_reason}</p>}
      {d.attempts.length > 1 && (
        <p className="trace__meta">
          Attempts:{' '}
          {d.attempts
            .map((a) => `${a.model} ${a.status} (${(a.latency_ms / 1000).toFixed(1)} s)`)
            .join(' → ')}
        </p>
      )}
    </li>
  );
}
