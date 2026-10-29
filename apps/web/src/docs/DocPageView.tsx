import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { DOC_PAGES } from './content';

/** Renders one Markdown page; internal links navigate in-app and code blocks get a copy button. */
export function DocPageView() {
  const { slug = '' } = useParams();
  const page = DOC_PAGES.find((p) => p.slug === slug);
  const ref = useRef<HTMLElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = page ? `${page.title} · DISMODO` : 'Not found · DISMODO';
    window.scrollTo(0, 0);
  }, [page]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    for (const pre of root.querySelectorAll('pre')) {
      if (pre.querySelector('.copy')) continue;
      const button = document.createElement('button');
      button.className = 'copy';
      button.type = 'button';
      button.textContent = 'Copy';
      button.addEventListener('click', async () => {
        await navigator.clipboard.writeText(pre.querySelector('code')?.textContent ?? '');
        button.textContent = 'Copied';
        window.setTimeout(() => (button.textContent = 'Copy'), 1500);
      });
      pre.append(button);
    }
  }, [page]);

  if (!page) {
    return (
      <article className="doc">
        <h1>Page not found</h1>
        <p>This page does not exist. Use the navigation to find what you need.</p>
      </article>
    );
  }
  return (
    <article
      ref={ref}
      className="doc"
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest('a');
        const href = anchor?.getAttribute('href');
        if (href?.startsWith('/docs')) {
          event.preventDefault();
          navigate(href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: page.html }}
    />
  );
}
