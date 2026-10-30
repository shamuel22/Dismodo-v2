// Calls the MCP tools the way an assistant would and prints their text output (for the demo film).
// Usage: DISMODO_API_KEY=… node scripts/film-mcp.mjs <session-id>
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'film', version: '1.0.0' });
await client.connect(
  new StdioClientTransport({
    command: 'node',
    args: ['apps/mcp/bin/dismodo-mcp.js'],
    env: { ...process.env, DISMODO_API_URL: process.env.DISMODO_API_URL ?? 'http://localhost:4100' },
  }),
);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n### ${name} ${JSON.stringify(args)}\n${r.content.map((c) => c.text).join('\n')}`);
};
await call('search_experiences', { query: 'fractions' });
await call('start_session', {
  experience: 'parts-of-a-whole',
  learner_ref: 'agent-demo',
  familiar_contexts: ['project-tasks'],
});
await call('get_evidence', { session_id: process.argv[2] });
await client.close();
