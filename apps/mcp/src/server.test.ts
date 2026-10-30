import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DismodoApiError, type DismodoClient } from '@dismodo/sdk';
import { createDismodoMcpServer } from './server';

const started: unknown[] = [];
const fake = {
  experiences: {
    search: async () => ({
      experiences: [
        {
          experience_ref: 'parts-of-a-whole@1.0.0',
          experience_id: 'parts-of-a-whole',
          title: 'One quarter of a set',
          objective: 'Find one quarter of a set of things.',
          skill: { id: 'fraction-of-a-set', name: 'Fraction of a set' },
          contexts: [{ id: 'materials', label: 'Sharing materials' }],
          time_budget_minutes: 8,
        },
      ],
    }),
  },
  sessions: {
    start: async (input: unknown) => {
      started.push(input);
      return {
        session: {
          session_id: '7b8be981-5051-424f-a9c6-050125e7f28e',
          url: 'http://localhost:4100/s/#' + 'T'.repeat(43),
          experience_ref: 'parts-of-a-whole@1.0.0',
          expires_at: '2026-11-06T00:00:00.000Z',
        },
      };
    },
    evidence: async (id: string) => {
      if (id === '00000000-0000-4000-8000-000000000000') {
        throw new DismodoApiError(404, 'not_found', 'No such session for this API key.');
      }
      return {
        status: 'completed',
        experience_ref: 'parts-of-a-whole@1.0.0',
        scope: 'this-skill-and-session',
        observations: {
          practice: { attempted: 3, correct: 2, hints_used: 1 },
          independent: { attempted: 2, correct: 2, target: 2 },
          interventions: [{ intervention: 'contrast', source: 'model', next_item_correct: true }],
        },
        statements: {
          observed: ['Independent check (held-out problems, no hints): 2 of 2 correct.'],
          learner_view: [],
          not_yet_checked: ['Retention over time (delayed check not measured).'],
        },
      };
    },
  },
} as unknown as DismodoClient;

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createDismodoMcpServer(fake).connect(serverSide);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
  return client;
}

describe('DISMODO MCP server', () => {
  it('offers exactly the consumer tools, with read-only hints where they apply', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_evidence', 'search_experiences', 'start_session']);
    expect(tools.find((t) => t.name === 'search_experiences')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'start_session')?.annotations?.readOnlyHint).toBe(false);
    expect(client.getInstructions()).toMatch(/cannot answer for the learner, grade, import or publish/);
  });

  it('searches, starts and reads evidence with structured output', async () => {
    const client = await connect();
    const found = await client.callTool({ name: 'search_experiences', arguments: { query: 'quarter' } });
    expect(found.structuredContent).toMatchObject({
      experiences: [{ experience_ref: 'parts-of-a-whole@1.0.0' }],
    });

    const session = await client.callTool({
      name: 'start_session',
      arguments: { experience: 'parts-of-a-whole', familiar_contexts: ['materials'] },
    });
    expect(session.structuredContent).toMatchObject({ session_id: '7b8be981-5051-424f-a9c6-050125e7f28e' });
    expect((session.structuredContent as { learner_ref: string }).learner_ref).toMatch(
      /^agent-[0-9a-f]{12}$/,
    );
    expect(started.at(-1)).toMatchObject({
      experience: 'parts-of-a-whole',
      declared: { familiar_contexts: ['materials'] },
    });

    const evidence = await client.callTool({
      name: 'get_evidence',
      arguments: { session_id: '7b8be981-5051-424f-a9c6-050125e7f28e' },
    });
    expect(evidence.structuredContent).toMatchObject({
      status: 'completed',
      independent: { correct: 2, attempted: 2 },
    });
    expect((evidence.content as Array<{ text: string }>)[0]!.text).toContain('Not yet checked:');
  });

  it('reports API errors as tool errors, not protocol failures', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'get_evidence',
      arguments: { session_id: '00000000-0000-4000-8000-000000000000' },
    });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]!.text).toBe(
      'DISMODO error 404 not_found: No such session for this API key.',
    );
  });

  it('rejects names or emails as learner refs by schema', async () => {
    const client = await connect();
    const res = await client.callTool({
      name: 'start_session',
      arguments: { experience: 'parts-of-a-whole', learner_ref: 'Ana García <ana@example.com>' },
    });
    expect(res.isError).toBe(true);
  });
});
