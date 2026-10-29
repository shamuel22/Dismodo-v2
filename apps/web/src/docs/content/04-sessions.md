---
slug: sessions
title: Sessions and events
nav: Sessions and events
---

# Sessions and events

A session is one learner working through one experience version. Its state is rebuilt from an append-only log of events; nothing is stored that the log cannot explain.

## Flow

1. **Starting item** (optional, `baseline`): no hints, to see where the learner begins.
2. **Practice**: hints on request, and support between items when the evidence calls for it.
3. **Independent check**: the package's reserved problems, new to the learner, no hints.
4. **Done**: the report is available.

## Starting a session

`POST /v1/sessions` with your key (`sessions:write`):

```json
{
  "experience": "parts-of-a-whole",
  "learner_ref": "learner-001",
  "declared": { "familiar_contexts": ["materials"], "energy": "ok" },
  "policy": "adaptive"
}
```

- `experience` takes `id@version` to pin a version, or `id` for the latest published one.
- `declared` is what the learner tells you up front; all optional.
- `policy: "fixed"` runs only the package's editorial route — useful as a comparison arm.

The response includes `session.url`: a link for the learner whose token sits after `#`, so it never reaches server logs. It expires after 7 days.

## Learner actions

The learner's page (or your own interface) sends actions. No action can state a result.

| Action                                   | Meaning                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `answer`                                 | A response to the current item, graded by the evaluator.                                                 |
| `hint_request`                           | The next progressive hint (practice only).                                                               |
| `unfamiliar_reference`                   | "I don't know this example": recorded apart from mistakes; the same problem is shown in another context. |
| `self_rating`                            | How sure the learner was: `confident`, `unsure` or `guessed`.                                            |
| `hypothesis_feedback`                    | Whether the stated reading of the difficulty fits, with an optional note.                                |
| `energy_check`                           | `low` shortens today's practice (if the package allows it).                                              |
| `continue`, `pause`, `resume`, `abandon` | Move through the session.                                                                                |

Send them to `POST /v1/sessions/:id/events` (your key) or `POST /v1/runtime/events` (the learner's token):

```json
{ "client_event_id": "retry-safe-id-001", "action": { "type": "hint_request", "item_id": "i2" } }
```

A repeated `client_event_id` returns the earlier result instead of acting twice.

## How adaptation decides

After each answer the engine may consult a decision model. The model only **chooses**: one support step from the interventions your package allows, and which known confusion best fits the evidence. It never writes text the learner sees and never grades.

- Confident correct answers skip the model entirely.
- **Muse Spark** handles routine decisions. **Muse Wonder** is consulted for harder moments: the learner rejected the last hypothesis, the same mistake happened twice, or a confident answer was wrong after support (at most twice per session).
- If a model is slow, fails or proposes something not allowed, the reviewed editorial route decides and the trace records why.
- Providers are configurable per tier (Meta Model API, any OpenAI-compatible endpoint, Anthropic).

## Memory across sessions

On the adaptive route, earlier sessions of the **same learner, skill and product** (last 5 sessions, 90 days) can orient a new one — for example, references marked unfamiliar are offered last. Every effect is recorded in the report. Learners can see and reset what is remembered: `GET /v1/learners/:ref/history`, `POST /v1/learners/:ref/history/reset`.
