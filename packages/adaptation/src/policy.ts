import type { DecisionRecord, ModelAttempt } from '@dismodo/contracts';
import { editorialPolicy, type AdaptationPolicy, type Decision, type PolicyInput } from '@dismodo/engine';
import { escalationReason } from './escalation';
import { ModelError, type DecisionModel } from './models/types';
import { buildDecisionPrompt, SYSTEM_PROMPT } from './prompt';
import { decisionSchema, validateDecision } from './validate';

export interface TierConfig {
  model: DecisionModel;
  timeoutMs: number;
  maxTokens: number;
}

export interface ModelPolicyOptions {
  routine: TierConfig | null;
  /** Stronger model for escalated decisions; falls back to routine when absent or failing. */
  critical?: TierConfig | null;
  /** Critical-tier consultations allowed per session (it is the slow, costly tier). */
  maxCriticalPerSession?: number;
}

/** Critical-tier decisions already made in this session, from recorded attempts. */
function criticalUsed(input: PolicyInput): number {
  const decisions = [
    ...input.state.interventions.map((i) => i.decision),
    ...input.state.decisions.map((d) => d.decision),
  ];
  return decisions.filter((d) => d.attempts?.some((a) => a.tier === 'critical')).length;
}

/**
 * The adaptive policy: deterministic rules first, then a decision model (routine or critical tier), with
 * validation of every proposal. Fallback order: critical → routine → the package's editorial route.
 * Learner-facing text is always reviewed content: the model selects, it does not write.
 */
export function createModelPolicy(options: ModelPolicyOptions): AdaptationPolicy {
  const maxCritical = options.maxCriticalPerSession ?? 2;
  return {
    name: 'adaptive',
    async afterEvaluation(input: PolicyInput): Promise<Decision> {
      const { item, state, runtime } = input;
      if (state.phase === 'independent') return { kind: 'continue' };
      // A confident (or unrated) correct answer needs no decision: do not make the learner wait.
      const doubt = item.self_rating === 'unsure' || item.self_rating === 'guessed';
      if (item.answer?.correct && !doubt) return { kind: 'continue' };

      const prompt = buildDecisionPrompt(input);
      // Nothing left to offer: "continue" is the only outcome, so no model is consulted.
      if (prompt.candidates.length === 0) return { kind: 'continue' };

      const escalation = criticalUsed(input) < maxCritical ? escalationReason(input) : null;
      const tiers: Array<{ name: 'routine' | 'critical'; config: TierConfig }> = [];
      if (escalation && options.critical) tiers.push({ name: 'critical', config: options.critical });
      if (options.routine) tiers.push({ name: 'routine', config: options.routine });

      const attempts: ModelAttempt[] = [];
      for (const tier of tiers) {
        const { model } = tier.config;
        const base = { provider: model.provider, model: model.model, tier: tier.name };
        const started = Date.now();
        try {
          const result = await model.complete({
            system: SYSTEM_PROMPT,
            user: prompt.user,
            schemaName: 'dismodo_decision',
            schema: decisionSchema(prompt.candidates, prompt.confusionIds),
            maxTokens: tier.config.maxTokens,
            timeoutMs: tier.config.timeoutMs,
          });
          const usage = {
            latency_ms: result.latency_ms,
            input_tokens: result.input_tokens,
            output_tokens: result.output_tokens,
            reasoning_tokens: result.reasoning_tokens,
          };
          const validation = validateDecision(result.content, {
            candidates: prompt.candidates,
            confusionIds: prompt.confusionIds,
            evidenceSeqs: prompt.evidenceSeqs,
            packagePhrases: runtime.pkg.tone.must_not_phrases,
          });
          if (!validation.ok) {
            attempts.push({ ...base, ...usage, status: 'invalid_output', error: validation.reason });
            continue;
          }
          attempts.push({ ...base, ...usage, status: 'ok' });
          const v = validation.decision;
          const confusion = runtime.pkg.confusions.find((c) => c.id === v.confusion_id) ?? null;
          const record: DecisionRecord = {
            source: 'model',
            rationale: v.rationale,
            hypothesis: confusion?.description ?? null,
            hypothesis_id: confusion?.id ?? null,
            model_interpretation: v.interpretation,
            evidence_seqs: v.evidence_seqs,
            model: { ...base, latency_ms: result.latency_ms },
            escalation_reason: escalation,
            attempts,
          };
          return v.action === 'intervene' && v.intervention
            ? { kind: 'intervene', intervention: v.intervention, decision: record }
            : { kind: 'continue', decision: record };
        } catch (error) {
          const e =
            error instanceof ModelError
              ? error
              : new ModelError('http_error', (error as Error).message, Date.now() - started);
          attempts.push({
            ...base,
            status: e.status,
            latency_ms: e.latency_ms,
            ...e.usage,
            error: e.message.slice(0, 200),
          });
        }
      }

      // No model produced a usable decision: the reviewed editorial route decides, and the trace says why.
      const fallback = await editorialPolicy.afterEvaluation(input);
      const reason =
        tiers.length === 0
          ? 'No decision model is configured.'
          : `All model attempts failed (${attempts.map((a) => `${a.tier}: ${a.status}`).join('; ')}).`;
      const record = (decision?: DecisionRecord): DecisionRecord => ({
        source: 'fallback',
        rationale: decision?.rationale ?? 'Continuing with the reviewed route.',
        hypothesis: decision?.hypothesis ?? null,
        hypothesis_id: decision?.hypothesis_id ?? null,
        evidence_seqs: decision?.evidence_seqs ?? [
          item.presented_seq,
          ...(item.answer ? [item.answer.seq] : []),
        ],
        fallback_reason: reason,
        escalation_reason: escalation,
        attempts,
      });
      return fallback.kind === 'intervene'
        ? { ...fallback, decision: record(fallback.decision) }
        : { kind: 'continue', decision: record() };
    },
  };
}
