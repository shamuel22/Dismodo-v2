import { marked } from 'marked';

export interface DocPage {
  slug: string;
  title: string;
  nav: string;
  status: 'Preview' | 'Planned' | null;
  markdown: string;
  html: string;
}

const sources = import.meta.glob('./content/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function parse(source: string): DocPage {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  const meta: Record<string, string> = {};
  for (const line of (match?.[1] ?? '').split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key)
      meta[key.trim()] = rest
        .join(':')
        .trim()
        .replace(/^'(.*)'$/, '$1');
  }
  const markdown = match ? source.slice(match[0].length) : source;
  return {
    slug: meta.slug ?? '',
    title: meta.title ?? '',
    nav: meta.nav ?? meta.title ?? '',
    status: meta.status === 'Preview' || meta.status === 'Planned' ? meta.status : null,
    markdown,
    // Our own reviewed content, bundled at build time; not user input.
    html: marked.parse(markdown, { async: false }) as string,
  };
}

/** Pages in file order (01-…, 02-…): the order the design spec §11 sets for the documentation. */
export const DOC_PAGES: DocPage[] = Object.keys(sources)
  .sort()
  .map((path) => parse(sources[path]!));
