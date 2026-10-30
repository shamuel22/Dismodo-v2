// Captures the builder-facing screens for the demo film: landing, docs, console trace and the Acme client.
// Usage: DISMODO_KEY=<key> ACME_PASS=<passcode> node scripts/film-capture-2.mjs <outDir>
import { chromium } from 'playwright';

const out = process.argv[2] ?? '.';
const base = process.env.WEB_URL ?? 'http://localhost:5173';
const acme = 'http://127.0.0.1:4300';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const shot = (name, opts = {}) => page.screenshot({ path: `${out}/${name}.png`, ...opts });

await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(7000);
await shot('b-landing');

for (const slug of ['', 'mcp', 'experience-packages']) {
  await page.goto(`${base}/docs/${slug}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot(`b-docs-${slug || 'overview'}`);
}
await page.goto(`${base}/llms.txt`);
await shot('b-llms');

await page.goto(`${base}/docs/console`);
await page.evaluate((k) => sessionStorage.setItem('dismodo.console-key', k), process.env.DISMODO_KEY);
await page.reload();
await page.waitForTimeout(2000);
await page.locator('table a, table button').first().click();
await page.waitForTimeout(2500);
await shot('b-console-trace', { fullPage: true });

const a = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  httpCredentials: { username: 'manager', password: process.env.ACME_PASS },
});
const ap = await a.newPage();
await ap.goto(acme + '/');
await ap.screenshot({ path: `${out}/b-acme-home.png` });
await ap.locator('form button, form [type=submit]').first().click();
await ap.waitForTimeout(3500);
await ap.screenshot({ path: `${out}/b-acme-practice.png` });
const board = ap.locator('dismodo-session');
const items = board.locator('button.set-board__item');
const total = await items.count();
console.log('acme items', total);
await ap.goto(acme + '/manager');
await ap.waitForTimeout(1500);
await ap.screenshot({ path: `${out}/b-acme-manager.png`, fullPage: true });
await browser.close();
