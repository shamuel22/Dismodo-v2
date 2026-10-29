---
slug: api
title: API reference
nav: API reference
---

# API reference

Base URL: your deployment (locally `http://localhost:4100`). Send keys as `Authorization: Bearer dsm_...`. Errors always look like `{ "error": { "code", "message", "details?" } }`.

## Keys and scopes

| Scope              | Allows                                                   |
| ------------------ | -------------------------------------------------------- |
| `packages:write`   | Validate, import, list and publish packages.             |
| `experiences:read` | Search experiences you can run.                          |
| `sessions:write`   | Start sessions, send actions, reset a learner's history. |
| `evidence:read`    | Reports, event logs, learner history, decision metrics.  |

## Endpoints

| Method | Path                                | Auth               | Purpose                                               |
| ------ | ----------------------------------- | ------------------ | ----------------------------------------------------- |
| GET    | `/health`                           | —                  | Status and configured decision models.                |
| GET    | `/v1/schemas/experience.json`       | —                  | Package JSON Schema.                                  |
| GET    | `/v1/components`                    | —                  | Registered activities, evaluators and interventions.  |
| POST   | `/v1/packages/validate`             | `packages:write`   | Validate without storing.                             |
| POST   | `/v1/packages`                      | `packages:write`   | Import an immutable draft version (idempotent).       |
| GET    | `/v1/packages`                      | `packages:write`   | Your packages.                                        |
| GET    | `/v1/packages/:id/:version`         | `packages:write`   | One version with its content.                         |
| GET    | `/v1/packages/attestation`          | —                  | The review statement publishing requires.             |
| POST   | `/v1/packages/:id/:version/publish` | `packages:write`   | Publish a reviewed draft.                             |
| GET    | `/v1/experiences?q=`                | `experiences:read` | Published experiences you can run (yours and public). |
| POST   | `/v1/sessions`                      | `sessions:write`   | Start a session; returns the learner link.            |
| GET    | `/v1/sessions/:id`                  | `sessions:write`   | Session and learner view.                             |
| POST   | `/v1/sessions/:id/events`           | `sessions:write`   | Send a learner action.                                |
| GET    | `/v1/sessions/:id/evidence`         | `evidence:read`    | Report computed from events.                          |
| GET    | `/v1/sessions/:id/events`           | `evidence:read`    | Full event log with decision traces.                  |
| GET    | `/v1/learners/:ref/history`         | `evidence:read`    | What is remembered per skill.                         |
| POST   | `/v1/learners/:ref/history/reset`   | `sessions:write`   | Stop using earlier evidence.                          |
| GET    | `/v1/metrics/decisions`             | `evidence:read`    | Model calls and route comparison.                     |

## Learner link endpoints

Authenticated with the session token (`Authorization: Session <token>`), limited to 90 requests per minute.

| Method | Path                   | Purpose                                                             |
| ------ | ---------------------- | ------------------------------------------------------------------- |
| GET    | `/v1/runtime/session`  | Current learner view.                                               |
| POST   | `/v1/runtime/events`   | Send a learner action.                                              |
| GET    | `/v1/runtime/evidence` | This session's report and decision trace (without model free text). |

## Playground

No key; public experiences only, isolated data, 12 sessions per minute per address.

| Method | Path                         | Purpose                  |
| ------ | ---------------------------- | ------------------------ |
| GET    | `/v1/playground/experiences` | Experiences you can try. |
| POST   | `/v1/playground/sessions`    | Start a session.         |

## Common error codes

`unauthorized`, `forbidden`, `invalid_package` (with `details.issues`), `version_conflict`, `attestation_required`, `experience_not_found`, `not_current_item`, `invalid_response`, `no_hints_left`, `session_closed`, `session_expired`, `rate_limited`.
