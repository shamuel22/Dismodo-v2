/**
 * Acme Onboarding — a second, independent product built on DISMODO.
 *
 * It keeps its own interface and brand, holds its own API key on the server, publishes its own experience
 * package (no engine changes) and embeds the learner session with <dismodo-session>. A manager page shows
 * the evidence Acme receives. Run the DISMODO API first; see README.md.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient, DismodoApiError, tokenFromSessionUrl, type SessionEvidence } from '@dismodo/sdk';
import { escape, layout } from './pages';

const PORT = Number(process.env.PORT ?? 4300);
const DISMODO = process.env.DISMODO_API_URL ?? 'http://localhost:4100';
const KEY = process.env.ACME_DISMODO_API_KEY;
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

/** Sessions Acme started, kept in memory for this demo (a real product would store them). */
const started: Array<{ id: string; sessionId: string; token: string; employee: string; at: Date }> = [];

async function ensurePackage() {
  const content = JSON.parse(
    await readFile(new URL('./experiences/halves-vs-quarters/experience.json', import.meta.url), 'utf8'),
  );
  const imported = await dismodo.packages.import(content);
  const ref = imported.package.ref;
  if (imported.package.status !== 'published') {
    await dismodo.packages.publish(content.experience_id, content.version, { reviewer: 'Acme L&D team' });
  }
  console.log(
    `Acme package ${ref} is published on DISMODO (${imported.created ? 'imported now' : 'already there'}).`,
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
  const rows = await Promise.all(
    started.map(async (s) => {
      const report: SessionEvidence | null = await dismodo.sessions.evidence(s.sessionId).catch(() => null);
      const name = EMPLOYEES.find((e) => e.ref === s.employee)?.name ?? s.employee;
      const o = report?.observations;
      return `<tr><td>${escape(name)}</td><td>${escape(report?.status ?? '…')}</td>
        <td>${o ? `${o.practice.correct}/${o.practice.attempted} (${o.practice.hints_used} hints)` : '—'}</td>
        <td>${o ? `${o.independent.correct}/${o.independent.attempted}` : '—'}</td>
        <td>${escape(report?.statements.not_yet_checked[0] ?? '')}</td></tr>`;
    }),
  );
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const html = (status: number, body: string) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  };
  try {
    if (req.method === 'GET' && url.pathname === '/') return html(200, homePage());
    if (req.method === 'POST' && url.pathname === '/start') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const employee = new URLSearchParams(body).get('employee') ?? '';
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
    if (req.method === 'GET' && url.pathname === '/manager') return html(200, await managerPage());
    return html(404, layout('Not found', '<p>Page not found.</p>'));
  } catch (error) {
    const message =
      error instanceof DismodoApiError ? `${error.code}: ${error.message}` : (error as Error).message;
    return html(502, layout('Error', `<p>DISMODO request failed: ${escape(message)}</p>`));
  }
});

await ensurePackage();
server.listen(PORT, () => console.log(`Acme Onboarding on http://localhost:${PORT}`));
