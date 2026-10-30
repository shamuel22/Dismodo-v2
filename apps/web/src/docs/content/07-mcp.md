---
slug: mcp
title: MCP
nav: MCP
status: Preview
---

# MCP

**Status: Preview.** DISMODO's MCP server lets a connected AI assistant use the engine as a consumer: find an experience, give a person a practice link, and read what happened afterwards. It lives in the repository at `apps/mcp` and talks to the DISMODO API with your product's key, so it sees exactly what that key allows.

## Tools

| Tool                 | What it does                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_experiences` | Find published experiences available to your product: objective, familiar contexts, time budget. Read-only.                                                     |
| `start_session`      | Start a session for a learner and return the link they open. Takes an optional pseudonymous `learner_ref`, `familiar_contexts` and `policy`.                    |
| `get_evidence`       | Read a session's evidence: status, practice with and without hints, new problems without hints, support given and by whom, and what was not checked. Read-only. |

The assistant cannot answer for the learner, grade, import or publish packages: those stay builder operations through the API and CLI, with review. Every tool returns readable text and structured output.

## Connect over stdio

For local assistants (Claude Code, Muse Code and other MCP clients that launch a command):

```json
{
  "mcpServers": {
    "dismodo": {
      "command": "node",
      "args": ["/path/to/dismodo/apps/mcp/bin/dismodo-mcp.js"],
      "env": { "DISMODO_API_KEY": "dsm_...", "DISMODO_API_URL": "http://localhost:4100" }
    }
  }
}
```

## Connect over HTTP

```bash
pnpm --filter @dismodo/mcp http        # Streamable HTTP on http://localhost:4200/mcp
```

Each request carries the key: `Authorization: Bearer dsm_...`. The server is stateless and creates a fresh instance per request, so callers never share a key or a tenant.

## Tested with

- The official MCP TypeScript client, over stdio and over HTTP (`scripts/mcp-e2e.mjs`).
- Claude Code as a connected assistant, over stdio.

Other clients are not yet verified.
