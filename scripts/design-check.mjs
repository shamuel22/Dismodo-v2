// Checks DESIGN.md §17 criteria that can be measured automatically. Usage: node scripts/design-check.mjs <outDir>
import { chromium } from 'playwright';

const out = process.argv[2] ?? '.';
const base = process.env.WEB_URL ?? 'http://localhost:5173';
const PHRASE =
  "The best learning methodology is the one that adapts to the context, the learning objective, the available resources and the learners' profile.";
const browser = await chromium.launch();
const results = {};

for (const width of [1440, 1024, 768, 390, 320]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  const before = await page.$eval('.hero__cta', (el) => el.getBoundingClientRect().top);
  await page.waitForTimeout(6500);
  const after = await page.$eval('.hero__cta', (el) => el.getBoundingClientRect().top);
  const brand = await page.$eval('.brand', (el) => {
    const r = el.getBoundingClientRect();
    const word = el.querySelector('.brand__word').getBoundingClientRect();
    const book = el.querySelector('.brand__book').getBoundingClientRect();
    return {
      fits: r.left >= 0 && r.right <= window.innerWidth,
      wordRightOfBook: word.left >= book.right - 1,
      sameRow: Math.abs((word.top + word.bottom) / 2 - (book.top + book.bottom) / 2) < 2,
    };
  });
  results[width] = {
    noLayoutShift: Math.abs(after - before) < 1,
    ...brand,
    phraseExact: (await page.$eval('.quote .sr-only', (el) => el.textContent)) === PHRASE,
    overflowX: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    h1: await page.$eval('h1', (el) => el.textContent.trim()),
  };
  await page.screenshot({ path: `${out}/landing-${width}.png` });
  await page.close();
}

// Zoom 200 %: emulate with a 720 px wide viewport at device scale 2 equivalent (CSS width halves).
const zoom = await browser.newPage({ viewport: { width: 720, height: 450 } });
await zoom.goto(base + '/', { waitUntil: 'networkidle' });
await zoom.waitForTimeout(6500);
results.zoom200 = {
  overflowX: await zoom.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
};
await zoom.screenshot({ path: `${out}/landing-zoom200.png`, fullPage: true });

// Keyboard: the hidden section offers no focusable controls; the docs link works before the intro ends.
const kb = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await kb.goto(base + '/', { waitUntil: 'domcontentloaded' });
await kb.waitForSelector('.hero__cta');
await kb.mouse.click(5, 400); // give the page focus without hitting a control
const focusOrder = [];
for (let i = 0; i < 6; i++) {
  await kb.keyboard.press('Tab');
  focusOrder.push(
    await kb.evaluate(
      () => document.activeElement?.textContent?.trim() || document.activeElement?.getAttribute('aria-label'),
    ),
  );
}
results.keyboard = {
  focusOrder,
  hiddenSectionNotFocusable: !focusOrder.includes('Explore the documentation'),
};
await kb.reload({ waitUntil: 'domcontentloaded' });
await kb.waitForSelector('.hero__cta'); // rendered; the intro is still playing
await kb.focus('.landing__nav-link');
await kb.keyboard.press('Tab'); // next stop: "View documentation", while the intro is still playing
const focused = await kb.evaluate(() => document.activeElement?.textContent?.trim());
await kb.keyboard.press('Enter');
await kb.waitForURL('**/docs', { timeout: 3000 }).catch(() => undefined);
results.keyboard.docsLinkWorksImmediately = kb.url().endsWith('/docs') ? focused : `no (${kb.url()})`;

// Anchor navigation (scroll cue) reveals the section.
const anchor = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await anchor.goto(base + '/', { waitUntil: 'networkidle' });
await anchor.click('.hero__scroll-cue');
await anchor.waitForTimeout(1200);
results.anchorReveals = await anchor.$eval('.scroll-reveal', (el) => el.classList.contains('is-visible'));

console.log(JSON.stringify(results, null, 1));
await browser.close();
