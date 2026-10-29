import { z } from 'zod';
import type { InterventionId } from './interventions';
import { Slug } from './primitives';

export const SessionPhase = z.enum(['baseline', 'practice', 'independent', 'done']);
export type SessionPhase = z.infer<typeof SessionPhase>;

export const SessionStatus = z.enum(['active', 'paused', 'completed', 'abandoned']);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SelfRating = z.enum(['confident', 'unsure', 'guessed']);
export type SelfRating = z.infer<typeof SelfRating>;

export const EnergyLevel = z.enum(['ok', 'low']);
export type EnergyLevel = z.infer<typeof EnergyLevel>;

/** What the learner (or a client acting for them) declares when a session starts. All optional. */
export const DeclaredContext = z.strictObject({
  /** Package context ids the learner recognises, most familiar first. */
  familiar_contexts: z.array(Slug).max(10).optional(),
  energy: EnergyLevel.optional(),
});
export type DeclaredContext = z.infer<typeof DeclaredContext>;

const ItemId = z.string().regex(/^i\d{1,3}$/);

/**
 * Actions a learner can take. Clients relay them; none of them can state a result: grading only happens
 * inside the engine through the package's evaluator.
 */
export const LearnerAction = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('answer'), item_id: ItemId, response: z.unknown() }),
  z.strictObject({ type: z.literal('hint_request'), item_id: ItemId }),
  /** "I don't know this example": a familiarity signal, recorded apart from mistakes. */
  z.strictObject({ type: z.literal('unfamiliar_reference'), item_id: ItemId }),
  z.strictObject({ type: z.literal('self_rating'), item_id: ItemId, rating: SelfRating }),
  /** The learner says whether the engine's reading of their difficulty fits. */
  z.strictObject({
    type: z.literal('hypothesis_feedback'),
    agrees: z.boolean(),
    note: z.string().trim().max(280).optional(),
  }),
  z.strictObject({ type: z.literal('energy_check'), level: EnergyLevel }),
  /** Move on after feedback or an explanation. */
  z.strictObject({ type: z.literal('continue') }),
  z.strictObject({ type: z.literal('pause') }),
  z.strictObject({ type: z.literal('resume') }),
  z.strictObject({ type: z.literal('abandon') }),
]);
export type LearnerAction = z.infer<typeof LearnerAction>;

/** Envelope for submitting an action; client_event_id makes retries safe. */
export const SubmitEvent = z.strictObject({
  client_event_id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
  action: LearnerAction,
});
export type SubmitEvent = z.infer<typeof SubmitEvent>;

/** One call to a decision model, kept for traces, cost and latency analysis. */
export interface ModelAttempt {
  provider: string;
  model: string;
  tier: 'routine' | 'critical';
  status: 'ok' | 'timeout' | 'http_error' | 'refused' | 'truncated' | 'invalid_output' | 'rejected';
  latency_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  /** Short reason when status is not ok. */
  error?: string;
}

export interface DecisionRecord {
  /** Who chose: the package's fixed editorial route, deterministic rules, or a model (validated). */
  source: 'editorial' | 'rules' | 'model' | 'fallback';
  /** Short, learner-safe explanation of why; never model reasoning. */
  rationale: string;
  /**
   * Hypothesis about the difficulty in this task, shown to the learner. Always reviewed text: a confusion
   * described in the package (or a fixed engine sentence), never free model output. Provisional by definition.
   */
  hypothesis: string | null;
  /** Package confusion the hypothesis comes from, when it does. */
  hypothesis_id?: string | null;
  /** The model's own reading, for builders' traces and reports only; never shown to learners. */
  model_interpretation?: string | null;
  /** Event sequence numbers the decision was based on. */
  evidence_seqs: number[];
  model?: { provider: string; model: string; tier: 'routine' | 'critical'; latency_ms: number } | null;
  fallback_reason?: string | null;
  /** Why the decision went to the critical tier, when it did. */
  escalation_reason?: string | null;
  /** Every model call made for this decision, in order (including failed ones). */
  attempts?: ModelAttempt[];
}

export interface RenderedExplanation {
  intervention: InterventionId;
  title: string;
  body: string;
  steps: string[];
}

/** Events the engine writes. Together with learner actions they fully determine a session. */
export type EngineEvent =
  | {
      type: 'session_started';
      experience_ref: string;
      content_hash: string;
      components: { activity: string; evaluator: string };
      engine_version: string;
      policy: 'adaptive' | 'fixed';
      seed: number;
      declared: DeclaredContext;
    }
  | {
      type: 'item_presented';
      item_id: string;
      phase: Exclude<SessionPhase, 'done'>;
      /** Problem identity; equal identities are the same exercise regardless of context. */
      identity: string;
      spec: unknown;
      context_id: string;
      prompt: string;
      view: unknown;
      /** Values for hint and explanation templates. Server-side only: may include the answer. */
      template_values: Record<string, string | number>;
      hints_allowed: number;
      /** Set when this item re-renders an earlier one in another context. */
      replaces?: string;
    }
  | {
      type: 'evaluated';
      item_id: string;
      correct: boolean;
      error_code: string | null;
      alternative_codes: string[];
      feedback: string;
      evaluator: string;
    }
  | { type: 'hint_given'; item_id: string; level: number; text: string }
  | { type: 'context_changed'; from: string; to: string; reason: 'unfamiliar_reference' | 'intervention' }
  | {
      type: 'intervention_started';
      intervention: InterventionId;
      explanation: RenderedExplanation | null;
      decision: DecisionRecord;
    }
  /** Earlier sessions of the same learner and skill shaped this one; effects are listed in plain words. */
  | { type: 'history_applied'; sessions: number; effects: string[] }
  /** A policy consultation that ended in "continue"; interventions carry their decision instead. */
  | { type: 'decision_recorded'; outcome: 'continue'; decision: DecisionRecord }
  | { type: 'phase_changed'; from: SessionPhase; to: SessionPhase; reason: string }
  | { type: 'status_changed'; to: SessionStatus; reason: string };

export type SessionEvent =
  | ({ seq: number; at: string; actor: 'learner' } & { action: LearnerAction })
  | ({ seq: number; at: string; actor: 'engine' } & { event: EngineEvent });
