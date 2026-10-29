---
slug: evidence
title: Evidence
nav: Evidence
---

# Evidence

`GET /v1/sessions/:id/evidence` (scope `evidence:read`) returns a report computed only from the session's validated events. The client never reports a result; the evaluator does.

## Four kinds of statement, kept apart

| Section           | Contains                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `observed`        | Facts from graded events: practice with and without hints, the independent check, what followed each intervention. |
| `interpretation`  | Provisional readings, each labelled with its source: `editorial`, `rules`, `model` or `fallback`.                  |
| `learner_view`    | What the learner said: unfamiliar references, self-ratings, agreement with hypotheses.                             |
| `not_yet_checked` | What the session cannot show: retention over time, transfer, help outside the product.                             |

## Key numbers

```json
{
  "observations": {
    "baseline": { "attempted": 1, "correct": 0 },
    "practice": { "attempted": 3, "correct": 2, "hints_used": 2, "correct_without_hints": 1 },
    "independent": { "attempted": 2, "correct": 2, "target": 2, "hints_used": 0 },
    "confidence_mismatches": { "confident_but_incorrect": 1, "unsure_but_correct": 0 },
    "delayed_check": "not_measured"
  },
  "scope": "this-skill-and-session"
}
```

_Illustrative values._ A correct answer with hints and one without are different evidence, and the report keeps them apart. Nothing here certifies mastery.

## Traces

- `GET /v1/sessions/:id/events` returns the full event log, including every decision: who decided (`model`, `editorial`, `rules`, `fallback`), which model and tier, latency, escalation and fallback reasons, and every model attempt.
- `GET /v1/metrics/decisions` summarises your product's model calls (latency percentiles, failures) and compares the adaptive and fixed routes. Sessions are not randomly assigned, so treat differences as signals, not effects.
