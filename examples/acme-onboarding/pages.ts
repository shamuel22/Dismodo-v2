/** Acme's own look: a light corporate portal. DISMODO only appears as the embedded practice. */
const STYLE = `
  :root { --acme-blue: #1d4ed8; --acme-ink: #0f172a; --acme-muted: #64748b; --acme-line: #e2e8f0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--acme-ink); background: #f8fafc; }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 28px; background: #fff; border-bottom: 1px solid var(--acme-line); }
  .logo { width: 28px; height: 28px; border-radius: 6px; background: var(--acme-blue); color: #fff; display: grid; place-items: center; font-weight: 700; }
  header strong { font-size: 17px; }
  header nav { margin-left: auto; display: flex; gap: 18px; font-size: 14px; }
  header a { color: var(--acme-muted); text-decoration: none; }
  main { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  p.lead { color: var(--acme-muted); margin: 0 0 28px; }
  .card { background: #fff; border: 1px solid var(--acme-line); border-radius: 12px; padding: 20px 22px; margin-bottom: 16px; }
  .card h2 { font-size: 18px; margin: 0 0 4px; }
  .muted { color: var(--acme-muted); font-size: 14px; }
  button, .btn { background: var(--acme-blue); color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; font: 600 14px inherit; cursor: pointer; text-decoration: none; display: inline-block; }
  select { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--acme-line); font: inherit; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; background: #fff; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--acme-line); vertical-align: top; }
  th { color: var(--acme-muted); font-weight: 600; }
  .tag { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: #eff6ff; color: var(--acme-blue); }
  dismodo-session { margin-top: 8px; }
`;

export function layout(title: string, body: string, extraHead = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Acme Onboarding</title><style>${STYLE}</style>${extraHead}</head><body>
<header><span class="logo">A</span><strong>Acme Onboarding</strong>
<nav><a href="/">My training</a><a href="/manager">Team progress</a></nav></header>
<main>${body}</main></body></html>`;
}

export function escape(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
