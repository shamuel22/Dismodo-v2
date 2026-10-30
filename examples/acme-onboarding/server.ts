/**
 * Acme Onboarding — a second, independent product built on DISMODO.
 *
 * It keeps its own interface and brand, holds its own API key on the server, publishes its own experience
 * package (no engine changes) and embeds the learner session with <dismodo-session>. A manager page shows
 * the evidence Acme receives. Run the DISMODO API first; see README.md.
 *
 * This example has no employee sign-in: anyone who can reach it can start sessions as a listed employee.
 * It therefore listens on loopback only, and the manager page needs ACME_MANAGER_PASSCODE. A real product
 * authenticates its own users before calling DISMODO.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient, DismodoApiError, tokenFromSessionUrl, type SessionEvidence } from '@dismodo/sdk';
import { escape, layout } from './pages';

const PORT = Number(process.env.PORT ?? 4300);
const HOST = process.env.HOST ?? '127.0.0.1';
const DISMODO = process.env.DISMODO_API_URL ?? 'http://localhost:4100';
const KEY = process.env.ACME_DISMODO_API_KEY;
const MANAGER_PASSCODE = process.env.ACME_MANAGER_PASSCODE ?? '';
const MAX_BODY = 4 * 1024;
/** Sessions kept for the manager page; older ones drop off (a real product would store them). */
const MAX_KEPT = 50;
if (!KEY) {
  console.error(
    'Set ACME_DISMODO_API_KEY (create one with: pnpm tenant:create --slug acme --name "Acme Onboarding").',
  );
  process.exit(1);
}
const dismodo = createClient({ baseUrl: DISMODO, apiKey: KEY });

/** Acme's employees, as Acme knows them. DISMODO only ever sees the pseudonymous ref. */
const EMPLOYEES = [
  { ref: 'acme-emp-1042', name: 'Dana (warehouse)' },
  { ref: 'acme-emp-2077', name: 'Luis (dispatch)' },
];
const EXPERIENCE = 'halves-vs-quarters';

const started: Array<{ id: string; sessionId: string; token: string; employee: string; at: Date }> = [];

async function ensurePackage() {
  const content = JSON.parse(
    await readFile(new URL('./experiences/halves-vs-quarters/experience.json', import.meta.url), 'utf8'),
  );
  const imported = await dismodo.packages.import(content);
  if (imported.package.status !== 'published') {
    await dismodo.packages.publish(content.experience_id, content.version, { reviewer: 'Acme L&D team' });
  }
  console.log(
    `Acme package ${imported.package.ref} is published on DISMODO (${imported.created ? 'imported now' : 'already there'}).`,
  );
}

function homePage(): string {
  const options = EMPLOYEES.map((e) => `<option value="${e.ref}">${escape(e.name)}</option>`).join('');
  return layout(
    'My training',
    `<h1>Week 1 training</h1>
     <p class="lead">Short practice sessions that adapt to how you work. Pick who is training today.</p>
     <div class="card">
       <span class="tag">Required</span>
       <h2>Reading parts of a team</h2>
       <p class="muted">Tell halves from quarters on rosters, deliveries and checklists. About 8 minutes.</p>
       <form method="post" action="/start">
         <label class="muted" for="employee">Employee</label>
         <select id="employee" name="employee">${options}</select>
         <button type="submit">Start practice</button>
       </form>
     </div>`,
  );
}

function sessionPage(token: string): string {
  return layout(
    'Practice',
    `<h1>Reading parts of a team</h1>
     <p class="lead">Your progress is saved as you go.</p>
     <dismodo-session token="${escape(token)}" api="${escape(DISMODO)}"></dismodo-session>`,
    `<script type="module" src="${escape(DISMODO)}/embed/dismodo-session.js"></script>`,
  );
}

async function managerPage(): Promise<string> {
  const rows: string[] = [];
  // Sequential over a bounded list: a page view never fans out into many parallel API calls.
  for (const s of started) {
    const report: SessionEvidence | null = await dismodo.sessions.evidence(s.sessionId).catch(() => null);
    const name = EMPLOYEES.find((e) => e.ref === s.employee)?.name ?? s.employee;
    const o = report?.observations;
    rows.push(`<tr><td>${escape(name)}</td><td>${escape(report?.status ?? '…')}</td>
      <td>${o ? `${o.practice.correct}/${o.practice.attempted} (${o.practice.hints_used} hints)` : '—'}</td>
      <td>${o ? `${o.independent.correct}/${o.independent.attempted}` : '—'}</td>
      <td>${escape(report?.statements.not_yet_checked[0] ?? '')}</td></tr>`);
  }
  return layout(
    'Team progress',
    `<h1>Team progress</h1>
     <p class="lead">Evidence DISMODO returns for each session: practice with help kept apart from new problems without hints.</p>
     ${
       rows.length
         ? `<table><thead><tr><th>Employee</th><th>Status</th><th>Practice (correct)</th><th>New problems, no hints</th><th>Not yet checked</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
         : '<p class="muted">No sessions yet. Start one from My training.</p>'
     }`,
  );
}

function managerAllowed(req: IncomingMessage): boolean {
  if (!MANAGER_PASSCODE) return false;
  const given = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
  const passcode = Buffer.from(given.slice(given.indexOf(':') + 1));
  const expected = Buffer.from(MANAGER_PASSCODE);
  return passcode.length === expected.length && timingSafeEqual(passcode, expected);
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams | null> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) return null;
  }
  return new URLSearchParams(body);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  // The Host header is client-controlled, so it is never used to build URLs.
  const url = new URL(req.url ?? '/', 'http://acme.local');
  const html = (status: number, body: string) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  };
  if (req.method === 'GET' && url.pathname === '/') return html(200, homePage());
  if (req.method === 'POST' && url.pathname === '/start') {
    const form = await readForm(req);
    if (!form) return html(413, layout('Error', '<p>Request too large.</p>'));
    const employee = form.get('employee') ?? '';
    if (!EMPLOYEES.some((e) => e.ref === employee))
      return html(400, layout('Error', '<p>Unknown employee.</p>'));
    const { session } = await dismodo.sessions.start({ experience: EXPERIENCE, learnerRef: employee });
    const id = randomBytes(9).toString('base64url');
    started.unshift({
      id,
      sessionId: session.session_id,
      token: tokenFromSessionUrl(session.url)!,
      employee,
      at: new Date(),
    });
    started.length = Math.min(started.length, MAX_KEPT);
    res.writeHead(303, { location: `/practice/${id}` });
    return res.end();
  }
  const practice = /^\/practice\/([\w-]+)$/.exec(url.pathname);
  if (req.method === 'GET' && practice) {
    const entry = started.find((s) => s.id === practice[1]);
    return entry
      ? html(200, sessionPage(entry.token))
      : html(404, layout('Not found', '<p>No such practice.</p>'));
  }
  if (req.method === 'GET' && url.pathname === '/manager') {
    if (!managerAllowed(req)) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="Acme managers"', 'content-type': 'text/plain' });
      return res.end(
        MANAGER_PASSCODE ? 'Manager passcode required.' : 'Set ACME_MANAGER_PASSCODE to enable this page.',
      );
    }
    return html(200, await managerPage());
  }
  return html(404, layout('Not found', '<p>Page not found.</p>'));
}

const server = createServer((req, res) => {
  req.on('error', () => undefined);
  handle(req, res).catch((error: unknown) => {
    const message =
      error instanceof DismodoApiError ? `${error.code}: ${error.message}` : (error as Error).message;
    if (res.headersSent) return res.end();
    res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
    res.end(layout('Error', `<p>DISMODO request failed: ${escape(message)}</p>`));
  });
});

await ensurePackage();
server.listen(PORT, HOST, () => console.log(`Acme Onboarding on http://${HOST}:${PORT}`));
