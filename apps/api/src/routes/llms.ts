import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

interface Doc {
  slug: string;
  title: string;
  status: string | null;
  markdown: string;
}

/** Reads the documentation's Markdown sources: the same files the web docs render. */
export function loadDocs(dir: string): Doc[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => {
      const source = readFileSync(path.join(dir, file), 'utf8');
      const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
      const meta = Object.fromEntries(
        (match?.[1] ?? '')
          .split('\n')
          .map((line) => line.split(':'))
          .filter(([key]) => key)
          .map(([key, ...rest]) => [
            key!.trim(),
            rest
              .join(':')
              .trim()
              .replace(/^'(.*)'$/, '$1'),
          ]),
      );
      return {
        slug: meta.slug ?? '',
        title: meta.title ?? file,
        status: meta.status ?? null,
        markdown: (match ? source.slice(match[0].length) : source).trimStart(),
      };
    });
}

/**
 * llms.txt for AI agents and tools (https://llmstxt.org): an index of the documentation with links to
 * plain Markdown, plus llms-full.txt with everything in one file.
 */
export function llmsRoutes(app: FastifyInstance, deps: { docsDir: string; publicBaseUrl: string }) {
  const docs = loadDocs(deps.docsDir);
  const mdUrl = (d: Doc) => `${deps.publicBaseUrl}/docs/${d.slug || 'index'}.md`;
  const index = [
    '# DISMODO',
    '',
    '> Adaptive learning engine. Builders publish versioned experience packages (objective, activity, evaluator, contexts, reviewed support); DISMODO runs sessions, adapts support with Meta Muse Spark / Muse Wonder within package limits, grades only with deterministic evaluators and returns evidence computed from events.',
    '',
    'Key facts for agents: REST API with Bearer keys (scopes packages:write, experiences:read, sessions:write, evidence:read); learner links carry a token after "#"; package JSON Schema at /v1/schemas/experience.json; registered components at /v1/components; public playground at POST /v1/playground/sessions (no key). MCP server (Preview): tools search_experiences, start_session, get_evidence over stdio or Streamable HTTP; see the MCP page.',
    '',
    '## Documentation',
    '',
    ...docs.map((d) => `- [${d.title}](${mdUrl(d)})${d.status ? ` (status: ${d.status})` : ''}`),
    '',
    '## Machine-readable',
    '',
    `- [Experience package JSON Schema](${deps.publicBaseUrl}/v1/schemas/experience.json)`,
    `- [Registered components](${deps.publicBaseUrl}/v1/components)`,
    `- [Everything in one file](${deps.publicBaseUrl}/llms-full.txt)`,
    '',
  ].join('\n');
  const full = docs.map((d) => `<!-- ${mdUrl(d)} -->\n${d.markdown.trim()}\n`).join('\n---\n\n');

  const text = { 'content-type': 'text/plain; charset=utf-8' };
  app.get('/llms.txt', async (_req, reply) => reply.headers(text).send(index));
  app.get('/llms-full.txt', async (_req, reply) => reply.headers(text).send(full));
  app.get<{ Params: { slug: string } }>('/docs/:slug.md', async (request, reply) => {
    const slug = request.params.slug === 'index' ? '' : request.params.slug;
    const doc = docs.find((d) => d.slug === slug);
    if (!doc) return reply.status(404).send({ error: { code: 'not_found', message: 'No such page.' } });
    return reply.headers({ 'content-type': 'text/markdown; charset=utf-8' }).send(doc.markdown);
  });
}
