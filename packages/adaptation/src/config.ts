import { z } from 'zod';
import { anthropicModel } from './models/anthropic';
import { withFault } from './models/faults';
import { openAICompatibleModel } from './models/openai-compatible';
import type { DecisionModel } from './models/types';
import type { ModelPolicyOptions, TierConfig } from './policy';

const Provider = z.enum(['meta', 'openai-compatible', 'anthropic', 'none']);

const DecisionEnv = z.object({
  DECISION_ROUTINE_PROVIDER: Provider.default('meta'),
  DECISION_ROUTINE_MODEL: z.string().default('muse-spark-1.3'),
  DECISION_ROUTINE_EFFORT: z.string().default('minimal'),
  DECISION_ROUTINE_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(8_000),
  DECISION_ROUTINE_MAX_TOKENS: z.coerce.number().int().min(200).max(32_000).default(1_500),
  DECISION_CRITICAL_PROVIDER: Provider.default('meta'),
  DECISION_CRITICAL_MODEL: z.string().default('muse-wonder-1.0'),
  // Measured on decision prompts (Oct 2026): Wonder ~16–17 s at minimal, ~22 s at low; Spark ~2–3 s at minimal.
  DECISION_CRITICAL_EFFORT: z.string().default('minimal'),
  DECISION_CRITICAL_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(30_000),
  DECISION_CRITICAL_MAX_TOKENS: z.coerce.number().int().min(200).max(32_000).default(4_000),
  /** Demonstrate the fallback path: make a tier fail in a chosen way. */
  DECISION_FAULT: z.enum(['none', 'timeout', 'error', 'invalid', 'refuse']).default('none'),
  DECISION_FAULT_TIER: z.enum(['routine', 'critical', 'all']).default('all'),
  META_API_KEY: z.string().default(''),
  META_BASE_URL: z.string().default('https://api.meta.ai/v1'),
  OPENAI_COMPAT_API_KEY: z.string().default(''),
  OPENAI_COMPAT_BASE_URL: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().default(''),
});
export type DecisionEnv = z.infer<typeof DecisionEnv>;

export interface TierSummary {
  tier: 'routine' | 'critical';
  provider: string;
  model: string;
  fault: string | null;
}

/** Builds the routine and critical tiers from environment variables. Missing credentials disable a tier. */
export function decisionTiersFromEnv(
  source: NodeJS.ProcessEnv,
): ModelPolicyOptions & { summary: TierSummary[] } {
  const env = DecisionEnv.parse(source);
  const summary: TierSummary[] = [];
  const build = (tier: 'routine' | 'critical'): TierConfig | null => {
    const upper = tier === 'routine' ? 'ROUTINE' : 'CRITICAL';
    const provider = env[`DECISION_${upper}_PROVIDER`];
    const modelId = env[`DECISION_${upper}_MODEL`];
    let model: DecisionModel | null = null;
    if (provider === 'meta' && env.META_API_KEY) {
      model = openAICompatibleModel({
        provider: 'meta',
        baseUrl: env.META_BASE_URL,
        apiKey: env.META_API_KEY,
        model: modelId,
        reasoningEffort: env[`DECISION_${upper}_EFFORT`],
      });
    } else if (provider === 'openai-compatible' && env.OPENAI_COMPAT_API_KEY && env.OPENAI_COMPAT_BASE_URL) {
      model = openAICompatibleModel({
        provider: 'openai-compatible',
        baseUrl: env.OPENAI_COMPAT_BASE_URL,
        apiKey: env.OPENAI_COMPAT_API_KEY,
        model: modelId,
      });
    } else if (provider === 'anthropic' && env.ANTHROPIC_API_KEY) {
      model = anthropicModel({ apiKey: env.ANTHROPIC_API_KEY, model: modelId });
    }
    if (!model) return null;
    const faulty =
      env.DECISION_FAULT !== 'none' &&
      (env.DECISION_FAULT_TIER === 'all' || env.DECISION_FAULT_TIER === tier);
    if (faulty)
      model = withFault(model, env.DECISION_FAULT as Exclude<DecisionEnv['DECISION_FAULT'], 'none'>);
    summary.push({
      tier,
      provider: model.provider,
      model: model.model,
      fault: faulty ? env.DECISION_FAULT : null,
    });
    return {
      model,
      timeoutMs: env[`DECISION_${upper}_TIMEOUT_MS`],
      maxTokens: env[`DECISION_${upper}_MAX_TOKENS`],
    };
  };
  return { routine: build('routine'), critical: build('critical'), summary };
}
