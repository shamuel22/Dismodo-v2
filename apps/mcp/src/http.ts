import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createClient } from '@dismodo/sdk';
import { createDismodoMcpServer } from './server';

const PORT = Number(process.env.MCP_PORT ?? 4200);
const API = process.env.DISMODO_API_URL ?? 'http://localhost:4100';
const MAX_BODY = 64 * 1024;

/**
 * Streamable HTTP, stateless: every request carries the product's API key (Authorization: Bearer dsm_…) and gets
 * its own server instance, so keys and tenants never mix between callers.
 */
const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/mcp') {
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
    return;
  }
  if (req.method !== 'POST') {
    res
      .writeHead(405, { allow: 'POST', 'content-type': 'application/json' })
      .end('{"error":"method_not_allowed"}');
    return;
  }
  const auth = req.headers.authorization;
  const apiKey = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!/^dsm_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/.test(apiKey)) {
    res
      .writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Bearer' })
      .end('{"error":"Send your DISMODO API key as Authorization: Bearer dsm_..."}');
    return;
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) {
      res.writeHead(413).end();
      return;
    }
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"invalid_json"}');
    return;
  }
  const server = createDismodoMcpServer(createClient({ baseUrl: API, apiKey }));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
});

httpServer.listen(PORT, () => console.log(`DISMODO MCP (Streamable HTTP) on http://localhost:${PORT}/mcp`));
