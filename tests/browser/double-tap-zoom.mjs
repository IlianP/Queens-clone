// Browser test: a quick double tap on the board must not zoom the page.
//
// iOS Safari ignores user-scalable=no in the viewport meta, and a quick second
// tap on a cell is the normal way to play (empty -> dot -> queen) — so the page
// zoomed in mid-game on iPhones (reported from Safari and the LinkedIn in-app
// browser). Two guards fix it, and this test pins both, because neither is
// visible in Chromium: Chromium honours the viewport meta, so the zoom itself
// never reproduces here and a regression would go unnoticed.
//
//   1. `touch-action: manipulation` on <html> — the effective touch-action is
//      the intersection over ancestors, so it covers every element on the page.
//   2. A non-passive touchend listener on the board that cancels the event —
//      what WebKit's double-tap recognizer actually respects. Input runs on
//      pointer events, so the taps themselves must still land.
//
// Prereqs: a static server on BASE_URL (default http://localhost:8000).
// Run: node tests/browser/double-tap-zoom.mjs — exits non-zero on failure.

import { stubStats } from './board-helpers.mjs';

const PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.js';
const CHROMIUM = '/opt/pw-browsers/chromium';
const BASE = process.env.BASE_URL || 'http://localhost:8000';

let failed = false;
function ok(cond, msg) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed = true;
}

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch({ executablePath: CHROMIUM });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'en-US',
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await stubStats(page);
// Quick mode off: a tap then cycles only the tapped cell, so the state after two
// taps is exactly "queen" and nothing else depends on auto-marks.
await page.addInitScript(() => {
  localStorage.setItem('queens-clone-settings', JSON.stringify({ quickMode: false, size: 6, difficulty: 'easy' }));
});
await page.goto(BASE + '/index.html');
await page.waitForFunction(() => {
  const b = document.querySelector('.board');
  const c = document.querySelector('.cell');
  return b && !b.classList.contains('intro-revealing') && c && c.dataset.state !== undefined;
}, null, { timeout: 25000 });

// Record whether the board's touchend got cancelled, read after it bubbled.
await page.evaluate(() => {
  window.__touchendPrevented = [];
  document.addEventListener('touchend', (e) => window.__touchendPrevented.push(e.defaultPrevented));
});

console.log('double-tap zoom guards');
const htmlTouch = await page.evaluate(() => getComputedStyle(document.documentElement).touchAction);
ok(htmlTouch === 'manipulation', `<html> touch-action is manipulation (got ${htmlTouch})`);

const target = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.cell')];
  const i = cells.findIndex((c) => c.dataset.state === 'empty');
  const r = cells[i].getBoundingClientRect();
  return { i, x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
const stateOf = (i) => page.evaluate((k) => document.querySelectorAll('.cell')[k].dataset.state, target.i);

// A quick double tap — the gesture iOS reads as "zoom in".
await page.touchscreen.tap(target.x, target.y);
await page.waitForTimeout(60);
await page.touchscreen.tap(target.x, target.y);
await page.waitForTimeout(100);

const prevented = await page.evaluate(() => window.__touchendPrevented);
ok(prevented.length === 2, `two touchend events reached the page (got ${prevented.length})`);
ok(prevented.every(Boolean), `every touchend on the board was cancelled (${JSON.stringify(prevented)})`);
const st = await stateOf(target.i);
ok(st === 'queen', `the two taps still landed: empty -> dot -> queen (got ${st})`);
const scale = await page.evaluate(() => (window.visualViewport ? window.visualViewport.scale : 1));
ok(scale === 1, `page not zoomed (visualViewport.scale ${scale})`);

// A button outside the board keeps its click: cancelling is scoped to the board.
const settingsOpened = await (async () => {
  const b = await page.$('#open-settings');
  const r = await b.boundingBox();
  await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
  await page.waitForTimeout(150);
  return page.evaluate(() => !document.getElementById('settings-overlay').hidden);
})();
ok(settingsOpened, 'a tap on a toolbar button still clicks it');

ok(errors.length === 0, `no page errors (${errors.join(' | ') || 'none'})`);
await browser.close();
if (failed) {
  console.log('FAILED');
  process.exit(1);
}
console.log('all passed');
