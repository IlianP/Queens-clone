// Browser test for the two surfaces of "rank among PLAYERS, not entries":
//
//   1. the renamed on-device tab ("Eigene" / "Mine" / "Perso" / …), which has to
//      survive six languages at phone width — the tab row is the tightest label
//      row in the app, and the measurement below found that the WORST case is
//      390px, not 320px: below 380px a media query shrinks the font, so a 390px
//      phone renders the full 0.85rem label in a still-narrow box;
//   2. the player's own best row being marked in the Bestenliste modal, which
//      previously highlighted nothing at all. With one enthusiast holding 34 of
//      the first 50 places, "count the rows until you find yourself" is not a
//      usable answer.
//
// SAFETY: every Supabase RPC is intercepted with page.route and answered
// locally — the live leaderboard is never read from or written to.
//
// Prereqs: static server on BASE_URL (default http://localhost:8000) and the
// environment's Playwright/Chromium (see board-helpers.mjs). Run with:
//
//   python3 -m http.server 8000 &
//   node tests/browser/player-rank.mjs

import { stubStats } from './board-helpers.mjs';
const PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.js';
const CHROMIUM = '/opt/pw-browsers/chromium';
const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

let failed = false;
const check = (msg, ok) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failed = true;
};

// The bucket the modal opens on (8x8 hard), shaped like the real one: a few
// names, many entries, the player's own best some way down the list.
const ROWS = [
  { name: 'Goose', seconds: 5, hints: 0, mistakes: 0, score: 5, created_at: '2026-09-13T11:42:54Z' },
  { name: 'Goose', seconds: 9, hints: 0, mistakes: 0, score: 9, created_at: '2026-09-15T09:08:00Z' },
  { name: 'Goose', seconds: 10, hints: 0, mistakes: 0, score: 10, created_at: '2026-09-13T12:40:12Z' },
  { name: 'IlianP', seconds: 12, hints: 0, mistakes: 0, score: 12, created_at: '2026-09-14T17:38:15Z' },
  { name: 'IlianP', seconds: 14, hints: 0, mistakes: 0, score: 14, created_at: '2026-07-27T14:19:50Z' },
  { name: 'D', seconds: 15, hints: 0, mistakes: 0, score: 15, created_at: '2026-09-15T10:00:00Z' },
];

// recent >= MIN_PERIOD_ENTRIES && recent < total is what makes main.js offer the
// third tab. That is the whole point here: the label row is only tight when all
// three are up, so a two-tab measurement would pass a label that cannot fit.
async function stubLeaderboard(page, { counts = { total: 12, recent: 6 } } = {}) {
  await page.route('**/rest/v1/rpc/top_scores', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) }));
  await page.route('**/rest/v1/rpc/score_counts', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([counts]) }));
  await page.route('**/rest/v1/rpc/player_rank', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ rank: 2, total: 3, is_best: true }]) }));
  await page.route('**/rest/v1/rpc/submit_score', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ rank: 4, total: 6 }]) }));
}

const LOCALES = [
  ['en-GB', 'en'],
  ['de-DE', 'de'],
  ['fr-FR', 'fr'],
  ['es-ES', 'es'],
  ['pt-BR', 'pt'],
  ['ru-RU', 'ru'],
];

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch({ executablePath: CHROMIUM });

try {
  // --- 1) the renamed tab, six languages x three widths --------------------
  // 390 first: it is the widest font in the narrowest box, so a label that fits
  // there fits everywhere. Asserting on element geometry (scrollWidth vs
  // clientWidth) rather than on the page, because `overflow-x: clip` on <body>
  // hides page-level overflow and a clipped tab reports nothing.
  for (const [locale, code] of LOCALES) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale });
    await stubStats(page);
    await stubLeaderboard(page);
    await page.goto(BASE_URL + '/index.html');
    await page.waitForSelector('html[data-i18n-ready]');
    await page.click('#open-leaderboard');
    await page.waitForSelector('#lb-tabs:not([hidden])');
    // The third tab is what makes the row tight; refuse to measure without it.
    await page.waitForSelector('#lb-tab-period:not([hidden])', { timeout: 5000 });
    const tabCount = await page.$$eval('#lb-tabs .score-tab', (b) => b.filter((x) => !x.hidden).length);
    check(`[${code}] all three tabs are up (the tight case)`, tabCount === 3);

    const label = await page.$eval('#lb-tab-local', (b) => b.textContent.trim());
    const aria = await page.$eval('#lb-tab-local', (b) => b.getAttribute('aria-label') || '');
    check(`[${code}] on-device tab reads "${label}"`, label.length > 0 && label !== 'Local');
    check(
      `[${code}] …and its aria-label carries the precision the label can't ("${aria}")`,
      aria.length > label.length
    );

    const notes = [];
    let ok = true;
    for (const width of [390, 360, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(80);
      const t = await page.$eval('#lb-tab-local', (b) => ({
        clipped: b.scrollWidth > b.clientWidth + 1,
        h: Math.round(b.getBoundingClientRect().height),
        need: b.scrollWidth,
        box: b.clientWidth,
      }));
      if (t.clipped || t.h >= 44) ok = false;
      notes.push(`${width}:${t.need}/${t.box}${t.clipped ? ' CLIPPED' : ''}`);
    }
    check(`[${code}] on-device tab never clips or wraps — ${notes.join(' ')}`, ok);
    await page.close();
  }

  // --- 2) the own row is marked in the Bestenliste modal -------------------
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
    await stubStats(page);
    await stubLeaderboard(page);
    // A remembered nickname is what identifies the player here — there is no
    // submit in this flow.
    await page.addInitScript(() => {
      localStorage.setItem(
        'queens-clone-settings',
        JSON.stringify({ language: 'de', size: 8, difficulty: 'hard', nickname: 'ilianp' })
      );
    });
    await page.goto(BASE_URL + '/index.html');
    await page.waitForSelector('html[data-i18n-ready]');
    await page.click('#open-leaderboard');
    await page.click('#lb-tab-global');
    await page.waitForFunction(() => document.querySelectorAll('#lb-scores .score-row').length > 0);

    const marked = await page.$$eval('#lb-scores .score-row', (rows) =>
      rows.map((r, i) => ({ i, me: r.classList.contains('me'), name: r.querySelector('.score-name').textContent }))
    );
    const mine = marked.filter((r) => r.me);
    check(`exactly one row is marked as mine (got ${mine.length})`, mine.length === 1);
    check(
      `and it is the player's BEST row, not just any of theirs (row ${mine[0] && mine[0].i})`,
      mine.length === 1 && mine[0].i === 3 && mine[0].name === 'IlianP'
    );
    check(
      'the nickname matches case-insensitively ("ilianp" finds "IlianP")',
      mine.length === 1 && mine[0].name === 'IlianP'
    );
    await page.close();
  }

  // --- 3) no nickname, nothing marked --------------------------------------
  // An anonymous row belongs to nobody in particular; outlining a stranger's
  // entry as "you" would be a lie the player has no way to check.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
    await stubStats(page);
    await stubLeaderboard(page);
    await page.goto(BASE_URL + '/index.html');
    await page.waitForSelector('html[data-i18n-ready]');
    await page.click('#open-leaderboard');
    await page.click('#lb-tab-global');
    await page.waitForFunction(() => document.querySelectorAll('#lb-scores .score-row').length > 0);
    const anyMarked = await page.$$eval('#lb-scores .score-row', (rows) =>
      rows.some((r) => r.classList.contains('me'))
    );
    check('without a remembered nickname no row is marked', !anyMarked);
    await page.close();
  }
} catch (e) {
  check(`test threw: ${e && e.message}`, false);
} finally {
  await browser.close();
}

console.log(failed ? '\nplayer-rank: FAILED' : '\nplayer-rank: all passed');
process.exit(failed ? 1 : 0);
