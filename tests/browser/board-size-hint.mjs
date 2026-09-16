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
//   4. a 14x14 really is playable on a phone.
import { boardSettled, stubStats } from './board-helpers.mjs';

const PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.js';
const CHROMIUM = '/opt/pw-browsers/chromium';
const BASE = process.env.BASE_URL || 'http://localhost:8000';
// Keep in step with TIGHT_CELL_PX / MAX_SIZE in js/main.js + js/settings.js.
const TIGHT_CELL_PX = 28;
const MAX_SIZE = 14;

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

// ---------- 1 + 2: the slider reaches MAX_SIZE, and the hint tracks the screen
for (const [label, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1440, height: 900 }],
]) {
  const { page, errors } = await open(viewport);
  await page.locator('#open-settings').click();
  await page.waitForSelector('#size-range', { state: 'visible' });

  const max = await page.evaluate(() => Number(document.getElementById('size-range').max));
  check(`[${label}] the slider reaches ${MAX_SIZE}`, max === MAX_SIZE, `(got ${max})`);

  let mismatches = 0;
  let everShown = false;
  for (let n = 5; n <= MAX_SIZE; n++) {
    const r = await probe(page, n);
    if (r.shown !== r.px < TIGHT_CELL_PX) {
      mismatches++;
      console.log(`      size ${n}: ${r.px.toFixed(1)}px but shown=${r.shown}`);
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
  check(
    `[${label}] ${label === 'phone' ? 'a phone sees it at least once' : 'a desktop never sees it'}`,
    label === 'phone' ? everShown : !everShown
  );
  check(`[${label}] no console errors`, errors.length === 0, errors[0] || '');
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
