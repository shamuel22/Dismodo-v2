// Captures the landing at chosen moments and widths. Usage: node scripts/shots.mjs <outDir>
import { chromium } from 'playwright';

const out = process.argv[2] ?? '.';
const base = process.env.WEB_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();

async function timeline(width, height, label) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  for (const ms of [0, 400, 900, 1500, 6500]) {
    if (ms) await page.waitForTimeout(ms - (page._last ?? 0));
    page._last = ms;
    await page.screenshot({ path: `${out}/${label}-${ms}.png` });
  }
  await page.close();
}

await timeline(1440, 900, 'd1440');
await timeline(390, 844, 'm390');
await timeline(320, 640, 'm320');

// Scroll behaviour: hidden after waiting; revealed after scrolling.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(7000);
const hiddenAfterWait = await page.$eval(
  '.scroll-reveal',
  (el) => !el.classList.contains('is-visible') && el.hasAttribute('inert'),
);
await page.mouse.wheel(0, 700);
await page.waitForTimeout(1200);
const visibleAfterScroll = await page.$eval(
  '.scroll-reveal',
  (el) => el.classList.contains('is-visible') && !el.hasAttribute('inert'),
);
await page.screenshot({ path: `${out}/d1440-scrolled.png` });
await page.mouse.wheel(0, -700);
await page.waitForTimeout(300);
const staysVisible = await page.$eval('.scroll-reveal', (el) => el.classList.contains('is-visible'));
// Tall screen: the section may intersect on load, but must stay hidden without scrolling.
const tall = await browser.newPage({ viewport: { width: 1024, height: 2400 } });
await tall.goto(base + '/', { waitUntil: 'networkidle' });
await tall.waitForTimeout(1500);
const tallHidden = await tall.$eval('.scroll-reveal', (el) => !el.classList.contains('is-visible'));
// Reduced motion: final brand and full phrase at once, section still hidden.
const reduced = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
await reduced.goto(base + '/', { waitUntil: 'networkidle' });
await reduced.waitForTimeout(200);
await reduced.screenshot({ path: `${out}/reduced-200.png` });
const reducedPhrase = await reduced.$eval('.quote__typed', (el) => el.textContent);
const reducedHidden = await reduced.$eval('.scroll-reveal', (el) => !el.classList.contains('is-visible'));
// No horizontal overflow at 320 px.
const narrow = await browser.newPage({ viewport: { width: 320, height: 640 } });
await narrow.goto(base + '/', { waitUntil: 'networkidle' });
await narrow.waitForTimeout(2000);
const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
console.log(
  JSON.stringify({
    hiddenAfterWait,
    visibleAfterScroll,
    staysVisible,
    tallHidden,
    reducedHidden,
    reducedPhraseComplete: reducedPhrase?.length,
    overflow320: overflow,
  }),
);
await browser.close();
