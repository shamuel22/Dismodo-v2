// End-to-end check of the MCP server with the official MCP client, over stdio and over Streamable HTTP.
// A learner plays the session through the returned link in between. Usage: DISMODO_API_KEY=… node scripts/mcp-e2e.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createRuntimeClient, tokenFromSessionUrl } from '@dismodo/sdk';

const API = process.env.DISMODO_API_URL ?? 'http://localhost:4100';
const KEY = process.env.DISMODO_API_KEY;

async function playAsLearner(url) {
  const runtime = createRuntimeClient({ baseUrl: API, sessionToken: tokenFromSessionUrl(url) });
  let { view } = await runtime.view();
  while (view.status === 'active') {
    const action =
      view.step.kind === 'item'
        ? {
            type: 'answer',
            item_id: view.step.item.item_id,
            response: {
              selected: Array.from({ length: view.step.item.view.total / 4 }, (_, i) => `e${i + 1}`),
            },
          }
        : { type: 'continue' };
    ({ view } = await runtime.submit(action));
  }
}

async function run(label, transport) {
  const client = new Client({ name: `dismodo-e2e-${label}`, version: '1.0.0' });
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  const found = await client.callTool({ name: 'search_experiences', arguments: { query: 'quarter' } });
  const ref = found.structuredContent.experiences.find((e) =>
    e.experience_ref.startsWith('parts-of-a-whole'),
  )?.experience_ref;
  const started = await client.callTool({
    name: 'start_session',
    arguments: { experience: 'parts-of-a-whole', learner_ref: `mcp-${label}-learner` },
  });
  await playAsLearner(started.structuredContent.learner_url);
  const evidence = await client.callTool({
    name: 'get_evidence',
    arguments: { session_id: started.structuredContent.session_id },
  });
  await client.close();
  return {
    tools,
    found: ref,
    status: evidence.structuredContent.status,
    independent: evidence.structuredContent.independent,
    text: evidence.content[0].text.split('\n')[0],
  };
}

const stdio = await run(
  'stdio',
  new StdioClientTransport({
    command: 'node',
    args: ['apps/mcp/bin/dismodo-mcp.js'],
    env: { ...process.env, DISMODO_API_KEY: KEY, DISMODO_API_URL: API },
  }),
);
const http = await run(
  'http',
  new StreamableHTTPClientTransport(new URL(process.env.MCP_URL ?? 'http://localhost:4200/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${KEY}` } },
  }),
);
console.log(JSON.stringify({ stdio, http }, null, 1));
