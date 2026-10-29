import type {
  DeclaredContext,
  ExperiencePackage,
  InterventionId,
  LearnerAction,
  RenderedExplanation,
  SelfRating,
  SessionEvent,
  SessionPhase,
  SessionStatus,
  ValidationIssue,
} from '@dismodo/contracts';

// Types in this file mirror the API's JSON responses exactly (snake_case included) where
// `@dismodo/contracts` has no shape for them, so callers see what the server actually sends.

/** Summary of a validated package, as returned by `describePackage` on the API. */
export interface PackageValidationSummary {
  candidate_pool: number;
  practice_pool: number;
  reserved_checks: number;
  tests_passed: number;
  tests_total: number;
  components: { activity: string; evaluator: string };
}

/** One stored package version, as listed and described by the packages API. */
export interface PackageSummary {
  experience_id: string;
  version: string;
  ref: string;
  status: 'draft' | 'published';
  visibility: 'private' | 'public';
  title: string;
  objective: string;
  locale: string;
  skill: { id: string; name: string };
  content_hash: string;
  components: { activity: string; evaluator: string };
  validation: PackageValidationSummary;
  created_at: string;
  published_at: string | null;
}

export interface ValidatePackageResponse {
  valid: boolean;
  issues: ValidationIssue[];
  summary: PackageValidationSummary | null;
}

export interface ImportPackageResponse {
  created: boolean;
  package: PackageSummary;
}

export interface ListPackagesResponse {
  packages: PackageSummary[];
}

export interface GetPackageResponse {
  package: PackageSummary;
  content: ExperiencePackage;
}

export interface PublishPackageResponse {
  package: PackageSummary;
}

export interface AttestationResponse {
  statement: string;
}

/** A published experience a tenant can run, from `GET /v1/experiences`. */
export interface ExperienceSummary {
  experience_ref: string;
  experience_id: string;
  version: string;
  owner: 'own' | 'public';
  title: string;
  objective: string;
  summary: string;
  locale: string;
  audience: string;
  skill: { id: string; name: string };
  prerequisites: string[];
  contexts: { id: string; label: string }[];
  time_budget_minutes: number;
  activity: string;
}

export interface SearchExperiencesResponse {
  experiences: ExperienceSummary[];
}

/** Session descriptor returned by the API; `url` is only present when a session is created. */
export interface SessionDescriptor {
  session_id: string;
  experience_ref: string;
  status: SessionStatus;
  phase: SessionPhase;
  policy: 'adaptive' | 'fixed';
  expires_at: string;
  created_at: string;
  completed_at: string | null;
}

export interface CreatedSessionDescriptor extends SessionDescriptor {
  url: string;
}

/** What a learner-facing client may show for one item. Never contains answer keys. */
export interface LearnerItemView {
  item_id: string;
  phase: Exclude<SessionPhase, 'done'>;
  prompt: string;
  view: unknown;
  context: { id: string; label: string };
  hints: string[];
  hints_left: number;
}

/** Learner-facing projection of a session, built by the API from the event log. */
export interface LearnerView {
  status: SessionStatus;
  phase: SessionPhase;
  experience: { title: string; objective: string };
  progress: {
    practice: { done: number; target: number };
    independent: { done: number; target: number };
  };
  step:
    | { kind: 'item'; item: LearnerItemView; can_flag_unfamiliar: boolean }
    | {
        kind: 'feedback';
        item: LearnerItemView;
        result: { correct: boolean; feedback: string };
        can_rate: boolean;
      }
    | {
        kind: 'explanation';
        explanation: RenderedExplanation;
        hypothesis: string | null;
        can_give_feedback: boolean;
      }
    | { kind: 'done' };
  notice: string | null;
  contexts: { id: string; label: string }[];
}

export interface StartSessionResponse {
  session: CreatedSessionDescriptor;
  view: LearnerView;
}

export interface SessionViewResponse {
  session: SessionDescriptor;
  view: LearnerView;
}

export interface SubmitSessionResponse {
  duplicate: boolean;
  accepted_seq: number;
  session: SessionDescriptor;
  view: LearnerView;
}

/** Evidence for one item, as projected into the session report. */
export interface ItemEvidence {
  item_id: string;
  phase: Exclude<SessionPhase, 'done'>;
  context_id: string;
  identity: string;
  correct: boolean | null;
  error_code: string | null;
  alternative_codes: string[];
  hints_used: number;
  self_rating: SelfRating | null;
  unfamiliar_reference: boolean;
  answer_ms: number | null;
}

/** Response of `GET /v1/sessions/:id/evidence`: the session report plus its id. */
export interface SessionEvidence {
  session_id: string;
  experience_ref: string;
  content_hash: string;
  components: { activity: string; evaluator: string };
  engine_version: string;
  policy: 'adaptive' | 'fixed';
  status: SessionStatus;
  phase: SessionPhase;
  started_at: string;
  completed_at: string | null;
  observations: {
    baseline: { attempted: number; correct: number } | null;
    practice: { attempted: number; correct: number; hints_used: number; correct_without_hints: number };
    independent: { attempted: number; correct: number; target: number; hints_used: 0 };
    interventions: Array<{
      intervention: InterventionId;
      source: 'editorial' | 'rules' | 'model' | 'fallback';
      hypothesis: string | null;
      learner_agreed: boolean | null;
      next_item_correct: boolean | null;
    }>;
    unfamiliar_references: string[];
    self_ratings: Record<SelfRating, number>;
    confidence_mismatches: { confident_but_incorrect: number; unsure_but_correct: number };
    delayed_check: 'not_measured';
  };
  items: ItemEvidence[];
  history: { sessions: number; effects: string[] } | null;
  statements: {
    observed: string[];
    interpretation: Array<{ text: string; source: 'editorial' | 'rules' | 'model' | 'fallback' }>;
    learner_view: string[];
    not_yet_checked: string[];
  };
  scope: 'this-skill-and-session';
}

/** One decision in a session as its link holder sees it: no model free text. */
export interface DecisionTraceEntry {
  seq: number;
  at: string;
  /** The intervention started, or "continue". */
  outcome: InterventionId | 'continue';
  source: 'editorial' | 'rules' | 'model' | 'fallback';
  /** Reviewed hypothesis text, when the decision named one. */
  hypothesis: string | null;
  /** Rationale for non-model decisions (model rationales stay builder-only). */
  rationale: string | null;
  escalation_reason: string | null;
  fallback_reason: string | null;
  model: { provider: string; model: string; tier: 'routine' | 'critical'; latency_ms: number } | null;
  attempts: Array<{
    provider: string;
    model: string;
    tier: 'routine' | 'critical';
    status: string;
    latency_ms: number;
  }>;
}

/** The report available to a learner link (`GET /v1/runtime/evidence`). */
export interface LearnerEvidence extends SessionEvidence {
  decisions: DecisionTraceEntry[];
}

export interface PlaygroundSessionInput {
  experience?: string;
  declared?: DeclaredContext;
  policy?: 'adaptive' | 'fixed';
  /** Anonymous id from an earlier playground session, so its history can inform this one. */
  learnerRef?: string;
}

export interface PlaygroundSessionResponse extends StartSessionResponse {
  learner_ref: string;
}

/** Alias matching the engine's report name. */
export type SessionReport = SessionEvidence;

export interface SessionEventsResponse {
  events: SessionEvent[];
}

/** Per-skill memory the API keeps for one learner. */
export interface LearnerSkillHistory {
  skill_key: string;
  sessions: number;
  interventions: Array<{ intervention: InterventionId; followed_by_correct: number; total: number }>;
  unfamiliar_contexts: string[];
  last_independent: { correct: number; attempted: number } | null;
}

export interface LearnerHistoryResponse {
  learner_ref: string;
  scope: string;
  skills: LearnerSkillHistory[];
}

export interface ResetHistoryResponse {
  learner_ref: string;
  skill_key: string | null;
  reset_at: string;
  note: string;
}

export interface DecisionModelMetrics {
  provider: string;
  model: string;
  tier: string;
  calls: number;
  ok: number;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  failures: Record<string, number>;
}

export interface DecisionCount {
  source: string | null;
  type: string;
  n: number;
}

export interface RouteMetrics {
  policy: string;
  sessions: number;
  completed: number;
  independent_attempted: number;
  independent_correct: number;
  practice_attempted: number;
  practice_correct: number;
  practice_hints: number;
}

export interface DecisionMetrics {
  models: DecisionModelMetrics[];
  decisions: DecisionCount[];
  routes: RouteMetrics[];
  note: string;
}

/** JSON Schema document for an experience package, from `GET /v1/schemas/experience.json`. */
export type ExperienceSchema = Record<string, unknown>;

export interface CatalogActivity {
  ref: string;
  revision: string;
  description: string;
  context_slots: string[];
  explanation_variables: string[];
  params_schema: unknown;
  spec_schema: unknown;
  response_schema: unknown;
}

export interface CatalogEvaluator {
  ref: string;
  revision: string;
  description: string;
  activity_refs: string[];
  error_codes: Record<string, string>;
  config_schema: unknown;
}

export interface CatalogIntervention {
  id: InterventionId;
  kind: 'explanation' | 'flow';
  label: string;
}

export interface CatalogComponents {
  activities: CatalogActivity[];
  evaluators: CatalogEvaluator[];
  interventions: CatalogIntervention[];
}

// Request-side shapes, named here so both clients share them.

export interface StartSessionInput {
  experience: string;
  learnerRef: string;
  declared?: DeclaredContext;
  policy?: 'adaptive' | 'fixed';
}

export interface SubmitOptions {
  clientEventId?: string;
}

export interface PublishOptions {
  reviewer: string;
  contentHash?: string;
}

export interface ResetHistoryOptions {
  skillKey?: string;
}

export type { DeclaredContext, ExperiencePackage, LearnerAction, SessionEvent, ValidationIssue };
