import { liveItems, type PolicyInput } from '@dismodo/engine';

/**
 * Deterministic rules for sending a decision to the critical tier (a stronger, slower model). They mark
 * moments where a wrong reading of the difficulty costs the most. Returns null for the routine tier.
 */
export function escalationReason({ state, item }: PolicyInput): string | null {
  // Ambiguous answers (several error patterns fit) stay on the routine tier: the prompt already asks for a
  // step that tells the patterns apart, and escalating every ambiguity would make the slow tier common.
  const lastIntervention = state.interventions.at(-1);
  if (lastIntervention?.learner_feedback && !lastIntervention.learner_feedback.agrees) {
    const decidedSince = state.decisions.some((d) => d.seq > lastIntervention.learner_feedback!.seq);
    if (!decidedSince) return 'The learner disagreed with the last hypothesis.';
  }
  const answered = liveItems(state).filter((i) => i.answer && i.phase !== 'independent');
  const [previous, last] = answered.slice(-2);
  if (
    previous &&
    last &&
    !previous.answer!.correct &&
    !last.answer!.correct &&
    previous.answer!.error_code !== null &&
    previous.answer!.error_code === last.answer!.error_code
  ) {
    return `The same mistake (${last.answer!.error_code}) happened twice in a row.`;
  }
  // Only an explanation counts here: a context swap or a shorter session is not teaching support.
  const lastExplanation = [...state.interventions].reverse().find((i) => i.explanation);
  if (lastExplanation && item.answer && !item.answer.correct && item.self_rating === 'confident') {
    return 'After an explanation, the learner was confident but the answer was not correct.';
  }
  return null;
}
