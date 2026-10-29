import { z } from 'zod';

/**
 * Interventions the engine knows how to run. A package allows a subset; the adaptation policy may only
 * choose among the allowed ones. "explanation" interventions need reviewed editorial content in the
 * package; "flow" interventions change the course of the session and are run by the engine itself.
 */
export const INTERVENTIONS = {
  essential: { kind: 'explanation', label: 'Essentials, plainly' },
  analogy: { kind: 'explanation', label: 'Everyday analogy' },
  'worked-example': { kind: 'explanation', label: 'Worked example' },
  'step-by-step': { kind: 'explanation', label: 'Step by step' },
  contrast: { kind: 'explanation', label: 'Contrast and decide' },
  'prerequisite-check': { kind: 'explanation', label: 'Check a prerequisite' },
  'swap-context': { kind: 'flow', label: 'Use a familiar reference' },
  'fade-support': { kind: 'flow', label: 'Fade support gradually' },
  'shorten-session': { kind: 'flow', label: 'Shorter steps for today' },
} as const satisfies Record<string, { kind: 'explanation' | 'flow'; label: string }>;

export type InterventionId = keyof typeof INTERVENTIONS;
export const InterventionId = z.enum(Object.keys(INTERVENTIONS) as [InterventionId, ...InterventionId[]]);

export function interventionKind(id: InterventionId): 'explanation' | 'flow' {
  return INTERVENTIONS[id].kind;
}
