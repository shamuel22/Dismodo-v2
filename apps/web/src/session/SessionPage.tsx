import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleDashed, Lightbulb, Pause, Play } from 'lucide-react';
import {
  createRuntimeClient,
  DismodoApiError,
  type LearnerAction,
  type LearnerEvidence,
  type LearnerView,
  type RuntimeClient,
} from '@dismodo/sdk';
import { BrandLockup } from '../brand/AnimatedBrand';
import { SetBoard, type SetView } from './SetBoard';
import './session.css';

const TOKEN_KEY = 'dismodo.session-token';
/** Show the "choosing" message only when a decision takes noticeably long, to avoid flicker. */
const SLOW_DECISION_MS = 700;

/** Reads the learner token from the URL fragment once, then removes it from the address bar. */
function takeToken(): string | null {
  const fromHash = window.location.hash.slice(1);
  if (/^[A-Za-z0-9_-]{43}$/.test(fromHash)) {
    try {
      sessionStorage.setItem(TOKEN_KEY, fromHash);
    } catch {
      // Private mode without storage: the token stays in memory for this page only.
    }
    window.history.replaceState(null, '', window.location.pathname);
    return fromHash;
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

type Load =
  | { state: 'loading' }
  | { state: 'ready'; view: LearnerView }
  | { state: 'error'; title: string; message: string };

function describeError(error: unknown): { title: string; message: string } {
  if (error instanceof DismodoApiError) {
    if (error.status === 410)
      return { title: 'This link has expired', message: 'Ask for a new session link.' };
    if (error.status === 401)
      return { title: 'This link is not valid', message: 'Check that the full link was opened.' };
    if (error.code === 'rate_limited')
      return { title: 'One moment', message: 'Too many actions in a short time. Try again shortly.' };
    return { title: 'Something went wrong', message: error.message };
  }
  return { title: 'Connection problem', message: 'Check your connection and try again.' };
}

export function SessionPage({ token: givenToken, embedded = false }: { token?: string; embedded?: boolean }) {
  const token = useMemo(() => givenToken ?? takeToken(), [givenToken]);
  const client = useMemo<RuntimeClient | null>(
    () => (token ? createRuntimeClient({ baseUrl: window.location.origin, sessionToken: token }) : null),
    [token],
  );
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!embedded) document.title = 'Session · DISMODO';
    if (!client) {
      setLoad({
        state: 'error',
        title: 'No session link',
        message: 'Open the full link you were given to start.',
      });
      return;
    }
    client.view().then(
      (res) => setLoad({ state: 'ready', view: res.view }),
      (error) => setLoad({ state: 'error', ...describeError(error) }),
    );
  }, [client, embedded]);

  const act = useCallback(
    async (action: LearnerAction, label: string) => {
      if (!client) return;
      setBusy(label);
      setActionError(null);
      const timer = window.setTimeout(() => setSlow(true), SLOW_DECISION_MS);
      try {
        const res = await client.submit(action);
        setLoad({ state: 'ready', view: res.view });
      } catch (error) {
        setActionError(describeError(error).message);
      } finally {
        window.clearTimeout(timer);
        setSlow(false);
        setBusy(null);
      }
    },
    [client],
  );

  if (load.state === 'loading') {
    return (
      <SessionFrame embedded={embedded}>
        <p className="session__status">Loading your session…</p>
      </SessionFrame>
    );
  }
  if (load.state === 'error') {
    return (
      <SessionFrame embedded={embedded}>
        <div className="session__empty">
          <h1 className="session__empty-title">{load.title}</h1>
          <p>{load.message}</p>
        </div>
      </SessionFrame>
    );
  }

  const view = load.view;
  return (
    <SessionFrame
      embedded={embedded}
      view={view}
      onPause={() => act({ type: view.status === 'paused' ? 'resume' : 'pause' }, 'pause')}
      busy={!!busy}
    >
      {view.notice && <p className="session__notice">{view.notice}</p>}
      {view.status === 'paused' ? (
        <div className="session__card session__paused">
          <h2 className="session__heading">Paused</h2>
          <p>Your progress is saved. Continue whenever you are ready.</p>
          <button
            className="button button--primary"
            onClick={() => act({ type: 'resume' }, 'resume')}
            disabled={!!busy}
          >
            <Play size={16} aria-hidden="true" /> Continue
          </button>
        </div>
      ) : (
        <Step view={view} act={act} busy={busy} slow={slow} client={client!} />
      )}
      {actionError && (
        <p className="session__error" role="alert">
          {actionError}
        </p>
      )}
    </SessionFrame>
  );
}

function SessionFrame({
  children,
  view,
  embedded,
  onPause,
  busy,
}: {
  children: React.ReactNode;
  view?: LearnerView;
  embedded: boolean;
  onPause?: () => void;
  busy?: boolean;
}) {
  const active = view && (view.status === 'active' || view.status === 'paused');
  return (
    <div className={`session${embedded ? ' session--embedded' : ''}`}>
      <header className="session__header">
        {!embedded && <BrandLockup size={22} />}
        {view && (
          <div className="session__meta">
            <span className="session__title">{view.experience.title}</span>
            <Progress view={view} />
          </div>
        )}
        {active && onPause && (
          <button className="button button--text session__pause" onClick={onPause} disabled={busy}>
            {view.status === 'paused' ? (
              <Play size={16} aria-hidden="true" />
            ) : (
              <Pause size={16} aria-hidden="true" />
            )}
            {view.status === 'paused' ? 'Resume' : 'Pause'}
          </button>
        )}
      </header>
      <main className="session__main">
        {view && view.step.kind !== 'done' && (
          <p className="session__objective">{view.experience.objective}</p>
        )}
        {children}
      </main>
    </div>
  );
}

/** Real counts only (DESIGN.md §13): practice and the independent check, never a decorative percentage. */
function Progress({ view }: { view: LearnerView }) {
  const { practice, independent } = view.progress;
  const checking = view.phase === 'independent' || view.phase === 'done';
  return (
    <span className="session__progress">
      {checking
        ? `New problems ${independent.done} of ${independent.target}`
        : view.phase === 'baseline'
          ? 'Warm-up'
          : `Practice ${practice.done} of ${practice.target}`}
    </span>
  );
}

function Step({
  view,
  act,
  busy,
  slow,
  client,
}: {
  view: LearnerView;
  act: (action: LearnerAction, label: string) => Promise<void>;
  busy: string | null;
  slow: boolean;
  client: RuntimeClient;
}) {
  const step = view.step;
  if (step.kind === 'item') return <ItemStep key={step.item.item_id} step={step} act={act} busy={busy} />;
  if (step.kind === 'feedback')
    return <FeedbackStep key={step.item.item_id} step={step} act={act} busy={busy} slow={slow} />;
  if (step.kind === 'explanation') return <ExplanationStep step={step} act={act} busy={busy} />;
  return <DoneStep client={client} />;
}

type ItemStepView = Extract<LearnerView['step'], { kind: 'item' }>;

function ItemStep({
  step,
  act,
  busy,
}: {
  step: ItemStepView;
  act: (a: LearnerAction, l: string) => Promise<void>;
  busy: string | null;
}) {
  const view = step.item.view as SetView;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [choice, setChoice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const ready = view.task === 'select' ? selected.size > 0 : choice !== null;
  const submit = () => {
    const response =
      view.task === 'select'
        ? { selected: [...selected] }
        : { choice: { n: Number(choice!.split('/')[0]), d: Number(choice!.split('/')[1]) } };
    void act({ type: 'answer', item_id: step.item.item_id, response }, 'answer');
  };
  const independent = step.item.phase === 'independent';

  return (
    <section className="session__card" aria-labelledby="item-prompt">
      <p className="session__eyebrow">
        {independent
          ? 'New problem, no hints'
          : step.item.phase === 'baseline'
            ? 'Warm-up, no hints'
            : 'Practice'}
        <span className="session__context"> · {step.item.context.label}</span>
      </p>
      <h2 id="item-prompt" className="session__prompt" tabIndex={-1} ref={headingRef}>
        {step.item.prompt}
      </h2>

      <SetBoard view={view} selected={selected} onToggle={toggle} />
      {view.task === 'select' && (
        <p className="session__count" aria-live="polite">
          Marked: {selected.size} of {view.total}
        </p>
      )}
      {view.task === 'identify' && view.options && (
        <fieldset className="session__options">
          <legend className="sr-only">Choose the fraction</legend>
          {view.options.map((option) => {
            const value = `${option.n}/${option.d}`;
            return (
              <label key={value} className={`session__option${choice === value ? ' is-chosen' : ''}`}>
                <input
                  type="radio"
                  name="fraction"
                  value={value}
                  checked={choice === value}
                  onChange={() => setChoice(value)}
                />
                {option.label}
              </label>
            );
          })}
        </fieldset>
      )}

      {step.item.hints.length > 0 && (
        <ol className="session__hints" aria-label="Hints">
          {step.item.hints.map((hint, i) => (
            <li key={i}>
              <Lightbulb size={15} aria-hidden="true" /> {hint}
            </li>
          ))}
        </ol>
      )}

      <div className="session__actions">
        <button className="button button--primary" onClick={submit} disabled={!ready || !!busy}>
          {busy === 'answer' ? 'Checking…' : 'Check answer'}
        </button>
        {step.item.hints_left > 0 && (
          <button
            className="button"
            onClick={() => act({ type: 'hint_request', item_id: step.item.item_id }, 'hint')}
            disabled={!!busy}
          >
            Hint ({step.item.hints_left} left)
          </button>
        )}
        {step.can_flag_unfamiliar && (
          <button
            className="button button--text"
            onClick={() => act({ type: 'unfamiliar_reference', item_id: step.item.item_id }, 'unfamiliar')}
            disabled={!!busy}
          >
            I don't know this example
          </button>
        )}
      </div>
    </section>
  );
}

type FeedbackStepView = Extract<LearnerView['step'], { kind: 'feedback' }>;

const RATINGS = [
  { value: 'confident', label: 'Sure' },
  { value: 'unsure', label: 'Not sure' },
  { value: 'guessed', label: 'I guessed' },
] as const;

function FeedbackStep({
  step,
  act,
  busy,
  slow,
}: {
  step: FeedbackStepView;
  act: (a: LearnerAction, l: string) => Promise<void>;
  busy: string | null;
  slow: boolean;
}) {
  const { correct, feedback } = step.result;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section className="session__card" aria-labelledby="result-title">
      <h2
        id="result-title"
        className={`session__result ${correct ? 'is-correct' : 'is-not'}`}
        tabIndex={-1}
        ref={headingRef}
      >
        {correct ? <Check size={20} aria-hidden="true" /> : <CircleDashed size={20} aria-hidden="true" />}
        {correct ? 'Correct' : 'Not this time'}
      </h2>
      <p className="session__feedback">{feedback}</p>

      {/* Confidence is asked separately from the result (DESIGN.md §13) and is optional. */}
      {step.can_rate ? (
        <div className="session__rating">
          <p className="session__rating-question">How sure were you when you answered?</p>
          <div className="session__rating-options">
            {RATINGS.map((r) => (
              <button
                key={r.value}
                className="button"
                onClick={() =>
                  act({ type: 'self_rating', item_id: step.item.item_id, rating: r.value }, 'rating')
                }
                disabled={!!busy}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="session__rating-done">Thanks, noted.</p>
      )}

      <div className="session__actions">
        <button
          className="button button--primary"
          onClick={() => act({ type: 'continue' }, 'continue')}
          disabled={!!busy}
        >
          {busy === 'continue' ? 'Continuing…' : 'Continue'}
        </button>
      </div>
      {busy === 'continue' && slow && (
        <p className="session__thinking" role="status">
          Choosing the next step for you…
        </p>
      )}
    </section>
  );
}

type ExplanationStepView = Extract<LearnerView['step'], { kind: 'explanation' }>;

function ExplanationStep({
  step,
  act,
  busy,
}: {
  step: ExplanationStepView;
  act: (a: LearnerAction, l: string) => Promise<void>;
  busy: string | null;
}) {
  const [disagreeing, setDisagreeing] = useState(false);
  const [note, setNote] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const { explanation } = step;
  return (
    <section className="session__card session__card--support" aria-labelledby="support-title">
      <p className="session__eyebrow session__eyebrow--support">Another way to look at it</p>
      <h2 id="support-title" className="session__heading" tabIndex={-1} ref={headingRef}>
        {explanation.title}
      </h2>
      <p className="session__body">{explanation.body}</p>
      {explanation.steps.length > 0 && (
        <ol className="session__steps">
          {explanation.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}

      {step.hypothesis && (
        <div className="session__hypothesis">
          <p>
            <span className="session__hypothesis-label">What may have happened: </span>
            {step.hypothesis}
          </p>
          {step.can_give_feedback ? (
            disagreeing ? (
              <form
                className="session__note"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(
                    {
                      type: 'hypothesis_feedback',
                      agrees: false,
                      ...(note.trim() ? { note: note.trim() } : {}),
                    },
                    'hypothesis',
                  );
                }}
              >
                <label htmlFor="hypothesis-note">What happened instead? (optional)</label>
                <textarea
                  id="hypothesis-note"
                  maxLength={280}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <span className="session__help">
                  Your words help choose the next step. They never change a result.
                </span>
                <div className="session__rating-options">
                  <button className="button" type="submit" disabled={!!busy}>
                    Send
                  </button>
                  <button className="button button--text" type="button" onClick={() => setDisagreeing(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="session__rating-options" role="group" aria-label="Does this fit?">
                <span className="session__rating-question">Does this fit?</span>
                <button
                  className="button"
                  onClick={() => act({ type: 'hypothesis_feedback', agrees: true }, 'hypothesis')}
                  disabled={!!busy}
                >
                  Yes
                </button>
                <button className="button" onClick={() => setDisagreeing(true)} disabled={!!busy}>
                  Not really
                </button>
              </div>
            )
          ) : (
            <p className="session__rating-done">Thanks, noted.</p>
          )}
        </div>
      )}

      <div className="session__actions">
        <button
          className="button button--primary"
          onClick={() => act({ type: 'continue' }, 'continue')}
          disabled={!!busy}
        >
          {busy === 'continue' ? 'Continuing…' : 'Try another one'}
        </button>
      </div>
    </section>
  );
}

/** Results come from the session's evidence, computed from events (never from the page). */
function DoneStep({ client }: { client: RuntimeClient }) {
  const [evidence, setEvidence] = useState<LearnerEvidence | null>(null);
  useEffect(() => {
    client.evidence().then(setEvidence, () => setEvidence(null));
  }, [client]);
  const o = evidence?.observations;
  return (
    <section className="session__card" aria-labelledby="done-title">
      <h2 id="done-title" className="session__heading">
        Session complete
      </h2>
      {o ? (
        <dl className="session__summary">
          <div>
            <dt>New problems, without hints</dt>
            <dd>
              {o.independent.correct} of {o.independent.attempted} correct
            </dd>
          </div>
          <div>
            <dt>Practice</dt>
            <dd>
              {o.practice.correct} of {o.practice.attempted} correct
              {o.practice.hints_used > 0
                ? `, ${o.practice.hints_used} hint${o.practice.hints_used === 1 ? '' : 's'} used`
                : ', no hints'}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="session__status">Loading your results…</p>
      )}
      <p className="session__scope">
        This describes this skill in this session. Whether it lasts over time has not been checked yet.
      </p>
    </section>
  );
}
