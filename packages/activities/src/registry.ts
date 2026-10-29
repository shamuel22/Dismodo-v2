import type { ActivityAdapter, ComponentRegistry, EvaluatorAdapter } from '@dismodo/contracts';
import { fractionOfSet } from './fraction-of-set';
import { setSelection } from './set-selection';

export function createRegistry(
  activities: ActivityAdapter[],
  evaluators: EvaluatorAdapter[],
): ComponentRegistry {
  const activityMap = new Map(activities.map((a) => [a.ref, a]));
  const evaluatorMap = new Map(evaluators.map((e) => [e.ref, e]));
  if (activityMap.size !== activities.length || evaluatorMap.size !== evaluators.length) {
    throw new Error('Duplicate component ref in registry.');
  }
  return {
    activity: (ref) => activityMap.get(ref),
    evaluator: (ref) => evaluatorMap.get(ref),
    activities: () => [...activityMap.values()],
    evaluators: () => [...evaluatorMap.values()],
  };
}

/** Components shipped with the engine. Each one is reviewed code with its own test suite. */
export const builtinRegistry: ComponentRegistry = createRegistry(
  [setSelection as ActivityAdapter],
  [fractionOfSet as EvaluatorAdapter],
);
