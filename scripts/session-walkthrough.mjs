// Plays a playground session in a real browser, like a learner, and captures each step.
// Usage: node scripts/session-walkthrough.mjs <outDir> [width]
import { chromium } from 'playwright';

const out = process.argv[2] ?? '.';
const width = Number(process.argv[3] ?? 1280);
const base = process.env.WEB_URL ?? 'http://localhost:5173';

const res = await fetch(`${base}/v1/playground/sessions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ declared: { familiar_contexts: ['project-tasks'] } }),
});
const { session } = await res.json();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 900 } });
const log = [];
let shot = 0;
const capture = async (name) =>
  page.screenshot({ path: `${out}/s${String(++shot).padStart(2, '0')}-${name}.png`, fullPage: true });

await page.goto(session.url);
await page.waitForSelector('.session__card');
log.push({ addressBarHasToken: page.url().includes('#') });

const items = () => page.locator('button.set-board__item');
async function mark(count) {
  for (let i = 0; i < count; i++) await items().nth(i).click();
}
async function step() {
  if (await page.locator('#item-prompt').count()) return 'item';
  if (await page.locator('#result-title').count()) return 'feedback';
  if (await page.locator('#support-title').count()) return 'explanation';
  if (await page.locator('#done-title').count()) return 'done';
  return 'unknown';
}

let mistakes = 1;
for (let guard = 0; guard < 40; guard++) {
  const kind = await step();
  if (kind === 'done') break;
  if (kind === 'item') {
    const total = await items().count();
    const eyebrow = await page.locator('.session__eyebrow').innerText();
    const wrong = eyebrow.startsWith('Practice') && mistakes-- > 0;
    await mark(wrong ? total - total / 4 : total / 4);
    if (shot < 2 || wrong) await capture(wrong ? 'item-wrong' : 'item');
    if (eyebrow.startsWith('Practice') && !wrong && !(await page.locator('.session__hints li').count())) {
      await page.getByRole('button', { name: /Hint/ }).click();
      await page.waitForSelector('.session__hints li');
      await capture('hint');
    }
    await page.getByRole('button', { name: 'Check answer' }).click();
    await page.waitForSelector('#result-title');
    log.push({ eyebrow, wrong, result: await page.locator('#result-title').innerText() });
  } else if (kind === 'feedback') {
    if (await page.getByRole('button', { name: 'Not sure' }).count()) {
      await page.getByRole('button', { name: wrongLast() ? 'Sure' : 'Not sure', exact: true }).click();
      await page.waitForSelector('.session__rating-done');
    }
    if (shot < 4) await capture('feedback');
    const started = Date.now();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForFunction(() => !document.querySelector('#result-title'), null, { timeout: 60000 });
    log.push({ continueMs: Date.now() - started });
  } else if (kind === 'explanation') {
    await capture('explanation');
    if (await page.getByRole('button', { name: 'Not really' }).count()) {
      await page.getByRole('button', { name: 'Not really' }).click();
      await page.fill('#hypothesis-note', 'I knew it was a quarter, I marked the wrong group.');
      await capture('hypothesis-note');
      await page.getByRole('button', { name: 'Send' }).click();
      await page.waitForSelector('.session__hypothesis .session__rating-done');
    }
    await page.getByRole('button', { name: 'Try another one' }).click();
    await page.waitForFunction(() => !document.querySelector('#support-title'));
  }
}
function wrongLast() {
  const last = log.filter((l) => 'wrong' in l).at(-1);
  return last?.wrong;
}
await page.waitForSelector('.session__summary', { timeout: 15000 });
await capture('done');
log.push({ summary: await page.locator('.session__summary').innerText() });
console.log(JSON.stringify(log, null, 1));
await browser.close();
