import { z } from 'zod';
import type { InterventionId } from '@dismodo/contracts';

/** Words and framings the engine never lets a model attach to a person, whatever the package says. */
const ENGINE_BANNED = [
  'learning style',
  'visual learner',
  'auditory learner',
  'kinesthetic',
  'mental age',
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

export const MAX_HYPOTHESIS = 200;
export const MAX_RATIONALE = 240;
export const MAX_BRIDGE = 160;

/** JSON Schema sent to the model: every field required, closed objects (strict structured output). */
export function decisionSchema(candidates: readonly InterventionId[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['action', 'intervention', 'hypothesis', 'rationale', 'evidence_seqs', 'bridge'],
    properties: {
      action: { type: 'string', enum: ['continue', 'intervene'] },
      intervention: { type: 'string', enum: [...candidates, 'none'] },
      hypothesis: { type: 'string' },
      rationale: { type: 'string' },
      evidence_seqs: { type: 'array', items: { type: 'integer' } },
      bridge: { type: 'string' },
    },
  };
}

const RawDecision = z.object({
  action: z.enum(['continue', 'intervene']),
  intervention: z.string(),
  hypothesis: z.string(),
  rationale: z.string(),
  evidence_seqs: z.array(z.int()),
  bridge: z.string(),
});

export type ValidDecision =
  | { action: 'continue'; hypothesis: string | null; rationale: string; evidence_seqs: number[] }
  | {
      action: 'intervene';
      intervention: InterventionId;
      hypothesis: string | null;
      rationale: string;
      evidence_seqs: number[];
      bridge: string | null;
      bridge_dropped: string | null;
    };

export type Validation = { ok: true; decision: ValidDecision } | { ok: false; reason: string };

function toneProblem(text: string, packagePhrases: readonly string[]): string | null {
  const lower = text.toLowerCase();
  const hit = [...ENGINE_BANNED, ...packagePhrases.map((p) => p.toLowerCase())].find((p) =>
    lower.includes(p),
  );
  if (hit) return `uses the excluded phrase "${hit}"`;
  if (/[<>]/.test(text)) return 'contains markup';
  return null;
}

/**
 * Checks a model's proposal before the controller sees it. Hypothesis and rationale must be clean or the
 * whole decision is rejected; a bad bridge sentence is dropped on its own, keeping the decision.
 */
export function validateDecision(
  content: string,
  context: {
    candidates: readonly InterventionId[];
    evidenceSeqs: readonly number[];
    allowedNumbers: ReadonlySet<string>;
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
  const hypothesis = raw.hypothesis.trim();
  const rationale = raw.rationale.trim();
  if (!rationale) return { ok: false, reason: 'missing rationale' };
  if (hypothesis.length > MAX_HYPOTHESIS || rationale.length > MAX_RATIONALE) {
    return { ok: false, reason: 'hypothesis or rationale too long' };
  }
  for (const text of [hypothesis, rationale]) {
    const problem = toneProblem(text, context.packagePhrases);
    if (problem) return { ok: false, reason: `hypothesis/rationale ${problem}` };
  }
  const unknownSeqs = raw.evidence_seqs.filter((seq) => !context.evidenceSeqs.includes(seq));
  if (unknownSeqs.length)
    return { ok: false, reason: `cites evidence that was not provided (${unknownSeqs.join(', ')})` };
  const evidence_seqs = [...new Set(raw.evidence_seqs)];

  if (raw.action === 'continue') {
    return {
      ok: true,
      decision: { action: 'continue', hypothesis: hypothesis || null, rationale, evidence_seqs },
    };
  }
  if (!context.candidates.includes(raw.intervention as InterventionId)) {
    return { ok: false, reason: `"${raw.intervention}" is not a candidate` };
  }
  if (evidence_seqs.length === 0) return { ok: false, reason: 'an intervention must cite evidence' };

  let bridge: string | null = raw.bridge.trim() || null;
  let bridge_dropped: string | null = null;
  if (bridge) {
    const strayNumbers = (bridge.match(/\d+/g) ?? []).filter((n) => !context.allowedNumbers.has(n));
    const problem =
      bridge.length > MAX_BRIDGE
        ? 'too long'
        : strayNumbers.length
          ? `uses numbers not in the item (${strayNumbers.join(', ')})`
          : toneProblem(bridge, context.packagePhrases);
    if (problem) {
      bridge_dropped = problem;
      bridge = null;
    }
  }
  return {
    ok: true,
    decision: {
      action: 'intervene',
      intervention: raw.intervention as InterventionId,
      hypothesis: hypothesis || null,
      rationale,
      evidence_seqs,
      bridge,
      bridge_dropped,
    },
  };
}
