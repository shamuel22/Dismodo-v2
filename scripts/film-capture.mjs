// Plays one adaptive session as a learner at 1920×1080 and captures each state for the demo film.
// Usage: DISMODO_KEY=<key> node scripts/film-capture.mjs <outDir>
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const out = process.argv[2] ?? '.';
const base = process.env.WEB_URL ?? 'http://localhost:5173';
const key = process.env.DISMODO_KEY;
const learnerRef = `film-${Date.now()}`;

const res = await fetch(`${base}/v1/sessions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({
    experience: 'parts-of-a-whole',
    learner_ref: learnerRef,
    declared: { familiar_contexts: ['sports-season', 'project-tasks'] },
  }),
});
const started = await res.json();
if (!res.ok) throw new Error(JSON.stringify(started));
const session = started.session ?? started;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const log = [];
let n = 0;
const capture = async (name) => {
  await page.waitForTimeout(400);
  const file = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: `${out}/${file}` });
  log.push({ file, text: (await page.locator('main').innerText()).slice(0, 600) });
};

await page.goto(session.url);
await page.waitForSelector('.session__card');
const items = () => page.locator('button.set-board__item');
const eyebrow = () => page.locator('.session__eyebrow').innerText();
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

// Mistakes planned: the first practice answer (confident), and one after the hypothesis is rejected.
let plannedWrong = 2;
let swapped = false;
let lastWrong = false;
let rejected = false;
for (let guard = 0; guard < 50; guard++) {
  const kind = await step();
  if (kind === 'done') break;
  if (kind === 'item') {
    if (!swapped && (await page.getByRole('button', { name: "I don't know this example" }).count())) {
      await capture('item-unfamiliar');
      await page.getByRole('button', { name: "I don't know this example" }).click();
      await page.waitForTimeout(1500);
      swapped = true;
      await capture('item-swapped');
      continue;
    }
    const total = await items().count();
    const label = await eyebrow();
    const wrong = label.startsWith('Practice') && plannedWrong > 0 && (plannedWrong === 2 || rejected);
    if (wrong) plannedWrong--;
    await mark(wrong ? (total * 3) / 4 : total / 4);
    await capture(wrong ? 'item-wrong' : 'item-right');
    await page.getByRole('button', { name: 'Check answer' }).click();
    await page.waitForSelector('#result-title');
    lastWrong = wrong;
  } else if (kind === 'feedback') {
    if (await page.getByRole('button', { name: 'Not sure' }).count()) {
      await page.getByRole('button', { name: lastWrong ? 'Sure' : 'Not sure', exact: true }).click();
      await page.waitForSelector('.session__rating-done');
    }
    await capture(lastWrong ? 'feedback-wrong' : 'feedback-right');
    const t = Date.now();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForFunction(() => !document.querySelector('#result-title'), null, { timeout: 60000 });
    log.push({ continueMs: Date.now() - t });
  } else if (kind === 'explanation') {
    await capture('explanation');
    if (!rejected && (await page.getByRole('button', { name: 'Not really' }).count())) {
      await page.getByRole('button', { name: 'Not really' }).click();
      await page.fill('#hypothesis-note', 'I marked the tasks that were left, not the ones done.');
      await capture('hypothesis-note');
      await page.getByRole('button', { name: 'Send' }).click();
      await page.waitForSelector('.session__hypothesis .session__rating-done');
      rejected = true;
    }
    await page.getByRole('button', { name: 'Try another one' }).click();
    await page.waitForFunction(() => !document.querySelector('#support-title'));
  } else {
    await capture('unknown');
    break;
  }
}
await page.waitForSelector('.session__summary', { timeout: 20000 });
await capture('done');

// Builder console: the key goes into this tab's storage, never onto the screen.
await page.goto(`${base}/docs/console`);
await page.evaluate((k) => sessionStorage.setItem('dismodo.console-key', k), key);
await page.reload();
await page.waitForTimeout(2500);
await capture('console');
writeFileSync(
  `${out}/log.json`,
  JSON.stringify({ session_id: session.session_id ?? session.id, learnerRef, log }, null, 1),
);
console.log(JSON.stringify(log.map((l) => l.file ?? l)));
await browser.close();
