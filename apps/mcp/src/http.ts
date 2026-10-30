import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createClient } from '@dismodo/sdk';
import { createDismodoMcpServer } from './server';

const PORT = Number(process.env.MCP_PORT ?? 4200);
/** Loopback by default: exposing it on a network is an explicit choice (MCP_HOST=0.0.0.0 behind a proxy). */
const HOST = process.env.MCP_HOST ?? '127.0.0.1';
const API = process.env.DISMODO_API_URL ?? 'http://localhost:4100';
const MAX_BODY = 64 * 1024;
const list = (value: string | undefined, fallback: string[]) =>
  value
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : fallback;
/** Host headers we answer to; guards a local server against DNS rebinding. */
const ALLOWED_HOSTS = list(process.env.MCP_ALLOWED_HOSTS, [`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
/** Browser origins allowed to call (none by default: MCP clients are not web pages). */
const ALLOWED_ORIGINS = list(process.env.MCP_ALLOWED_ORIGINS, []);
const KEY_PATTERN = /^dsm_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/;

function reply(res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) return null;
  }
  return raw;
}

/**
 * Streamable HTTP, stateless: every request carries the product's API key (Authorization: Bearer dsm_…) and gets
 * its own server instance, so keys and tenants never mix between callers.
 */
async function handle(req: IncomingMessage, res: ServerResponse) {
  // Host and Origin are checked before anything else is read (MCP transport security guidance).
  if (!ALLOWED_HOSTS.includes(req.headers.host ?? '')) return reply(res, 421, { error: 'host_not_allowed' });
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply(res, 403, { error: 'origin_not_allowed' });
  if ((req.url ?? '').split('?')[0] !== '/mcp') return reply(res, 404, { error: 'not_found' });
  if (req.method !== 'POST') return reply(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' });

  const auth = req.headers.authorization;
  const apiKey = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!KEY_PATTERN.test(apiKey)) {
    return reply(
      res,
      401,
      { error: 'Send your DISMODO API key as Authorization: Bearer dsm_...' },
      { 'www-authenticate': 'Bearer' },
    );
  }
  const raw = await readBody(req);
  if (raw === null) return reply(res, 413, { error: 'body_too_large' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(res, 400, { error: 'invalid_json' });
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
}

const httpServer = createServer((req, res) => {
  // Every failure, including a client hanging up mid-upload, ends this request only: never the process.
  req.on('error', () => undefined);
  handle(req, res).catch((error: unknown) => {
    console.error('dismodo-mcp: request failed:', (error as Error).message);
    reply(res, 500, { error: 'internal_error' });
  });
});

httpServer.listen(PORT, HOST, () =>
  console.log(`DISMODO MCP (Streamable HTTP) on http://${HOST}:${PORT}/mcp`),
);
