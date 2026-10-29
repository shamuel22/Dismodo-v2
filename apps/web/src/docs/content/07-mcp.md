---
slug: mcp
title: MCP
nav: MCP
status: Planned
---

# MCP

**Status: Planned.** The MCP server is the next stage of development. This page describes what it will expose; nothing here is available yet.

DISMODO's MCP server will let a connected AI assistant use the engine as a consumer:

| Tool                 | What it will do                                                 |
| -------------------- | --------------------------------------------------------------- |
| `search_experiences` | Find published experiences available to the connected product.  |
| `start_session`      | Start a session for a learner and return the learner link.      |
| `get_evidence`       | Read a session's report once the learner has worked through it. |

Importing or publishing packages will **not** be an MCP tool: those stay builder operations through the API and CLI, with review.

Until then, agents can use the [API](/docs/api) directly, and [`/llms.txt`](/llms.txt) gives a plain-text map of this documentation.
