// The board-size hint, and the rule behind it: every size is pickable on every
// screen, and the app says how small a cell would get instead of deciding for
// the player.
//
//   python3 -m http.server 8000
//   node tests/browser/board-size-hint.mjs
//
// This exists because the first version of sizes 13/14 did the opposite — it
// capped the slider to what a screen could show "properly". That is a judgement
// about someone's eyes, thumbs and zoom habits, none of which this code can
// measure, and it hid the feature from phone players without ever telling them
// it was there. The measurement below is the evidence that settled it: a 14x14
// on a phone is SMALL, not broken — it lays out with no overflow, nothing under
// the top bar, and a single tap still lands on exactly one cell.
//
// So the invariants here are:
//   1. the slider reaches MAX_SIZE on a phone, not just on a desktop;
//   2. the hint appears exactly when a cell would render below the threshold on
//      THIS screen, and says the measured figure;
//   3. it follows a resize, because the figure stops being true when the window
//      changes;
//   4. a 14x14 really is playable on a phone;
//   5. the threshold follows the POINTER, not just the screen — see below.
//
// Invariant 5 is the reason this file runs the same viewport under two pointer
// types. A thumb needs more room than a cursor, and above HARD_ONLY_SIZE
// columns on touch it needs more room than the measurement can be trusted to
// have found: CSS pixels are a vendor calibration, not a physical size, so a
// generously calibrated phone clears the plain touch threshold at 13x13 while
// the cells sit under exactly the same thumb. Nothing at runtime compares these
// numbers, which is why they are restated and checked here.
import { boardSettled, stubStats } from './board-helpers.mjs';

const PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.js';
const CHROMIUM = '/opt/pw-browsers/chromium';
const BASE = process.env.BASE_URL || 'http://localhost:8000';
// Keep in step with js/main.js + js/settings.js.
const TIGHT_CELL_PX = 28;
const TIGHT_CELL_PX_TOUCH = 32;
const TIGHT_CELL_PX_TOUCH_BIG = 40;
const HARD_ONLY_SIZE = 12;
const MAX_SIZE = 14;

// The rule under test, restated: tightCellLimit() in js/main.js.
const limitFor = (n, touch) =>
  !touch ? TIGHT_CELL_PX : n > HARD_ONLY_SIZE ? TIGHT_CELL_PX_TOUCH_BIG : TIGHT_CELL_PX_TOUCH;

// A phone is a touch device; a narrow desktop window is not. Playwright only
// reports '(pointer: coarse)' when the context says hasTouch.
const TOUCH_CTX = { hasTouch: true, isMobile: true, deviceScaleFactor: 3 };

let failed = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ` ${extra}` : ''}`);
  if (!cond) failed++;
};

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch({ executablePath: CHROMIUM });

async function open(viewport, opts = {}) {
  const page = await browser.newPage({ viewport, locale: opts.locale || 'de-DE', ...opts.ctx });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  await stubStats(page);
  await page.route('**/rest/v1/rpc/**', (r) => r.fulfill({ status: 200, body: '[]' }));
  if (opts.storage) {
    await page.addInitScript((s) => {
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, opts.storage);
  }
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-i18n-ready'));
  return { page, errors };
}

// Read the hint for one slider position, plus the cell size it is talking about.
const probe = (page, size) =>
  page.evaluate((n) => {
    const range = document.getElementById('size-range');
    range.value = String(n);
    range.dispatchEvent(new Event('input', { bubbles: true }));
    const hint = document.getElementById('size-hint');
    const board = document.getElementById('board');
    const wasXl = board.classList.contains('board-xl');
    board.classList.toggle('board-xl', n > 12);
    const px = board.offsetWidth / n;
    board.classList.toggle('board-xl', wasXl);
    return { shown: !hint.hidden, text: hint.textContent, px };
  }, size);

// ---------- 1 + 2 + 5: the slider reaches MAX_SIZE, and the hint tracks both
// the screen and the pointer. The same 390px viewport appears twice on purpose:
// under a thumb and under a cursor it is not the same question.
for (const { label, viewport, touch, sees } of [
  { label: 'phone', viewport: { width: 390, height: 844 }, touch: true, sees: true },
  { label: 'narrow window', viewport: { width: 390, height: 844 }, touch: false, sees: true },
  { label: 'desktop', viewport: { width: 1440, height: 900 }, touch: false, sees: false },
]) {
  const { page, errors } = await open(viewport, { ctx: touch ? TOUCH_CTX : {} });
  await page.locator('#open-settings').click();
  await page.waitForSelector('#size-range', { state: 'visible' });

  const max = await page.evaluate(() => Number(document.getElementById('size-range').max));
  check(`[${label}] the slider reaches ${MAX_SIZE}`, max === MAX_SIZE, `(got ${max})`);

  // If this drifts, every expectation below would silently test the other
  // branch and still pass.
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  check(`[${label}] the browser reports pointer: ${touch ? 'coarse' : 'fine'}`, coarse === touch);

  let mismatches = 0;
  let everShown = false;
  for (let n = 5; n <= MAX_SIZE; n++) {
    const r = await probe(page, n);
    if (r.shown !== r.px < limitFor(n, touch)) {
      mismatches++;
      console.log(`      size ${n}: ${r.px.toFixed(1)}px vs limit ${limitFor(n, touch)} but shown=${r.shown}`);
    }
    if (r.shown) {
      everShown = true;
      // The figure has to be the measured one, not a guess or a constant.
      if (!r.text.includes(String(Math.round(r.px)))) {
        mismatches++;
        console.log(`      size ${n}: text does not quote ${Math.round(r.px)}px — "${r.text}"`);
      }
    }
  }
  check(`[${label}] the hint matches the measured cell size at every size`, mismatches === 0);
  check(`[${label}] ${sees ? 'sees it at least once' : 'never sees it'}`, everShown === sees);
  check(`[${label}] no console errors`, errors.length === 0, errors[0] || '');
  await page.close();
}

// ---------- 5: the case the touch thresholds exist for
// A big phone whose 14x14 measures ABOVE the plain touch figure. Before the
// pointer-aware thresholds this screen saw nothing at all at 13/14 — the
// reported symptom — because the measurement is in CSS pixels, which a
// generously calibrated device hands out more of across the same glass.
{
  const { page, errors } = await open({ width: 500, height: 980 }, { ctx: TOUCH_CTX });
  await page.locator('#open-settings').click();
  await page.waitForSelector('#size-range', { state: 'visible' });

  for (const n of [13, MAX_SIZE]) {
    const r = await probe(page, n);
    const between = r.px > TIGHT_CELL_PX_TOUCH && r.px < TIGHT_CELL_PX_TOUCH_BIG;
    check(
      `[big phone] ${n}x${n} measures past the plain touch figure and is hinted anyway`,
      between && r.shown,
      `(${r.px.toFixed(1)}px, shown=${r.shown})`
    );
  }

  // ...and the wider figure is scoped to boards above HARD_ONLY_SIZE, not a
  // blanket 40px for touch: 12x12 measures below 40 here and must stay silent.
  const r12 = await probe(page, HARD_ONLY_SIZE);
  check(
    `[big phone] ${HARD_ONLY_SIZE}x${HARD_ONLY_SIZE} keeps the plain touch figure`,
    r12.px > TIGHT_CELL_PX_TOUCH && r12.px < TIGHT_CELL_PX_TOUCH_BIG && !r12.shown,
    `(${r12.px.toFixed(1)}px, shown=${r12.shown})`
  );
  check('[big phone] no console errors', errors.length === 0, errors[0] || '');
  await page.close();
}

// A tablet is the case the wider figure must NOT reach: it renders 45-49px at
// these sizes, which is genuinely roomy, and a hint there would be the false
// positive that teaches players to ignore the real ones.
{
  const { page } = await open({ width: 820, height: 1180 }, { ctx: { hasTouch: true } });
  await page.locator('#open-settings').click();
  await page.waitForSelector('#size-range', { state: 'visible' });
  let shown = 0;
  let worst = 0;
  for (let n = 5; n <= MAX_SIZE; n++) {
    const r = await probe(page, n);
    if (r.shown) shown++;
    worst = worst === 0 ? r.px : Math.min(worst, r.px);
  }
  check('[tablet] a roomy touch screen is never hinted at any size', shown === 0,
    `(smallest cell ${worst.toFixed(1)}px, hinted ${shown}x)`);
  await page.close();
}

// ---------- 3: it follows a resize, because the figure stops being true
{
  const { page } = await open({ width: 1440, height: 900 });
  await page.locator('#open-settings').click();
  await page.waitForSelector('#size-range', { state: 'visible' });
  const before = await probe(page, MAX_SIZE);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForFunction(() => !document.getElementById('size-hint').hidden, null, { timeout: 3000 })
    .catch(() => {});
  const after = await page.evaluate(() => {
    const h = document.getElementById('size-hint');
    return { shown: !h.hidden, text: h.textContent };
  });
  check('a resize re-reads the figure', !before.shown && after.shown,
    `(desktop shown=${before.shown} → phone shown=${after.shown})`);
  await page.close();
}

// ---------- the hint has to fit; French/Russian run longest (see CLAUDE.md)
for (const locale of ['fr-FR', 'ru-RU']) {
  const { page } = await open({ width: 360, height: 640 }, { locale });
  await page.locator('#open-settings').click();
  await page.waitForSelector('#size-range', { state: 'visible' });
  await probe(page, MAX_SIZE);
  const fit = await page.evaluate(() => {
    const h = document.getElementById('size-hint');
    const card = h.closest('.settings-card') || h.parentElement;
    return {
      text: h.textContent,
      overflows: h.scrollWidth > h.clientWidth + 1,
      spills: h.getBoundingClientRect().right > card.getBoundingClientRect().right + 1,
    };
  });
  check(`[${locale}] the hint fits its card`, !fit.overflows && !fit.spills, `"${fit.text.slice(0, 60)}…"`);
  await page.close();
}

// ---------- 4: the evidence — a 14x14 really is playable on a phone
{
  const { page, errors } = await open(
    { width: 390, height: 844 },
    {
      ctx: { hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
      storage: {
        'queens-clone-settings': JSON.stringify({
          size: MAX_SIZE, difficulty: 'hard', language: 'de', introAnimation: false, quickMode: true,
        }),
      },
    }
  );
  await boardSettled(page, 45000);
  const n = await page.evaluate(() => Math.round(Math.sqrt(document.querySelectorAll('.cell').length)));
  check(`a stored ${MAX_SIZE} is honoured on a phone, not clamped away`, n === MAX_SIZE, `(got ${n})`);

  const layout = await page.evaluate(() => {
    const d = document.documentElement;
    const top = document.querySelector('.topbar').getBoundingClientRect();
    const b = document.getElementById('board').getBoundingClientRect();
    return {
      overflowX: d.scrollWidth > d.clientWidth,
      underTopbar: b.top < top.bottom - 1,
      offscreen: b.bottom > d.clientHeight + 1,
    };
  });
  check('it lays out: no sideways overflow, nothing under the top bar, nothing cut off',
    !layout.overflowX && !layout.underTopbar && !layout.offscreen, JSON.stringify(layout));

  // One tap, one cell: the thing a cap would have been protecting against.
  const target = await page.evaluate((size) => {
    const cells = [...document.querySelectorAll('.cell')];
    const idx = 3 * size + 5;
    const r = cells[idx].getBoundingClientRect();
    return { idx, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, MAX_SIZE);
  await page.mouse.click(target.x, target.y);
  const hit = await page.evaluate((idx) => {
    const cells = [...document.querySelectorAll('.cell')];
    return {
      state: cells[idx].dataset.state,
      changed: cells.filter((c) => c.dataset.state && c.dataset.state !== 'empty').length,
    };
  }, target.idx);
  check('a single tap marks exactly one cell', hit.state === 'dot' && hit.changed === 1,
    `(state=${hit.state}, changed=${hit.changed})`);
  check('no console errors', errors.length === 0, errors[0] || '');
  await page.close();
}

await browser.close();
console.log(failed === 0 ? '\nboard-size-hint: all passed' : `\nboard-size-hint: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
