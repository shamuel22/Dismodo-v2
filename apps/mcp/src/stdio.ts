import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient } from '@dismodo/sdk';
import { createDismodoMcpServer } from './server';

const apiKey = process.env.DISMODO_API_KEY;
if (!apiKey) {
  // stderr only: stdout belongs to the MCP protocol.
  console.error('dismodo-mcp: set DISMODO_API_KEY (and DISMODO_API_URL, default http://localhost:4100).');
  process.exit(1);
}
const client = createClient({ baseUrl: process.env.DISMODO_API_URL ?? 'http://localhost:4100', apiKey });
await createDismodoMcpServer(client).connect(new StdioServerTransport());
