import { z } from 'zod';
import type { InterventionId } from '@dismodo/contracts';

/**
 * Framings the engine never accepts in model text, whatever the package says. This screens builder-facing
 * trace notes; learner-facing text never comes from the model (it is selected from reviewed content).
 */
const ENGINE_BANNED = [
  'learning style',
  'visual learner',
  'auditory learner',
  'kinesthetic',
  'mental age',
  'intelligence',
  'iq',
  'bad at',
  "can't learn",
  'cannot learn',
  'slow learner',
  'not smart',
  'stupid',
  'dumb',
  'lazy',
  'disorder',
  'dyscalculia',
  'adhd',
  'like a child',
  'for kids',
];

export const MAX_NOTE = 240;

/** JSON Schema sent to the model: every field required, closed objects (strict structured output). */
export function decisionSchema(candidates: readonly InterventionId[], confusionIds: readonly string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['action', 'intervention', 'confusion_id', 'interpretation', 'rationale', 'evidence_seqs'],
    properties: {
      action: { type: 'string', enum: ['continue', 'intervene'] },
      intervention: { type: 'string', enum: [...candidates, 'none'] },
      confusion_id: { type: 'string', enum: [...confusionIds, 'none'] },
      interpretation: { type: 'string' },
      rationale: { type: 'string' },
      evidence_seqs: { type: 'array', items: { type: 'integer' } },
    },
  } as Record<string, unknown>;
}

const RawDecision = z.object({
  action: z.enum(['continue', 'intervene']),
  intervention: z.string(),
  confusion_id: z.string(),
  interpretation: z.string(),
  rationale: z.string(),
  evidence_seqs: z.array(z.int()),
});

export interface ValidDecision {
  action: 'continue' | 'intervene';
  intervention: InterventionId | null;
  confusion_id: string | null;
  interpretation: string | null;
  rationale: string;
  evidence_seqs: number[];
}

export type Validation = { ok: true; decision: ValidDecision } | { ok: false; reason: string };

function screen(text: string, packagePhrases: readonly string[]): string | null {
  const words = ` ${text.toLowerCase().replace(/[^a-z0-9']+/g, ' ')} `;
  const hit = [...ENGINE_BANNED, ...packagePhrases.map((p) => p.toLowerCase())].find((p) =>
    words.includes(` ${p.replace(/[^a-z0-9']+/g, ' ').trim()} `),
  );
  if (hit) return `uses the excluded phrase "${hit}"`;
  if (/[<>]/.test(text)) return 'contains markup';
  return null;
}

/** Checks a model's proposal before the controller sees it. Any problem rejects the whole decision. */
export function validateDecision(
  content: string,
  context: {
    candidates: readonly InterventionId[];
    confusionIds: readonly string[];
    evidenceSeqs: readonly number[];
    packagePhrases: readonly string[];
  },
): Validation {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { ok: false, reason: 'output is not JSON' };
  }
  const parsed = RawDecision.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'output does not match the decision schema' };
  const raw = parsed.data;
  const interpretation = raw.interpretation.trim();
  const rationale = raw.rationale.trim();
  if (!rationale) return { ok: false, reason: 'missing rationale' };
  if (interpretation.length > MAX_NOTE || rationale.length > MAX_NOTE)
    return { ok: false, reason: 'text too long' };
  for (const text of [interpretation, rationale]) {
    const problem = screen(text, context.packagePhrases);
    if (problem) return { ok: false, reason: `interpretation/rationale ${problem}` };
  }
  if (raw.confusion_id !== 'none' && !context.confusionIds.includes(raw.confusion_id)) {
    return { ok: false, reason: `"${raw.confusion_id}" is not a known confusion` };
  }
  const unknownSeqs = raw.evidence_seqs.filter((seq) => !context.evidenceSeqs.includes(seq));
  if (unknownSeqs.length)
    return { ok: false, reason: `cites evidence that was not provided (${unknownSeqs.join(', ')})` };
  const evidence_seqs = [...new Set(raw.evidence_seqs)];
  const base = {
    confusion_id: raw.confusion_id === 'none' ? null : raw.confusion_id,
    interpretation: interpretation || null,
    rationale,
    evidence_seqs,
  };
  if (raw.action === 'continue')
    return { ok: true, decision: { action: 'continue', intervention: null, ...base } };
  if (!context.candidates.includes(raw.intervention as InterventionId)) {
    return { ok: false, reason: `"${raw.intervention}" is not a candidate` };
  }
  if (evidence_seqs.length === 0) return { ok: false, reason: 'an intervention must cite evidence' };
  return {
    ok: true,
    decision: { action: 'intervene', intervention: raw.intervention as InterventionId, ...base },
  };
}
