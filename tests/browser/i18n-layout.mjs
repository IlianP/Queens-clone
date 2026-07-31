// Browser test for the LAYOUT half of i18n: does every language pack still fit
// the chrome it renders in?
//
// `tests/logic/verify-i18n.mjs` guards the packs structurally (same keys, same
// types, same parameters). Nothing there — and nothing a human can see in a diff
// — catches a translation that is simply too long for its box. This test does.
//
// Why the naive check is not enough: `<body>` has `overflow-x: clip`, so a row
// that no longer fits does NOT produce a scrollbar, and the page-level
// `scrollWidth > clientWidth` probe stays silent. On top of that `.brand` is a
// column flex with `align-items: flex-start`, which sizes children to their own
// content and lets them spill *past* the column, so a shrunken `.brand` left the
// `<h1>` at full width painting "Queens" underneath the toolbar buttons. German
// had been shaving the "s" off since the packs landed; it only became obvious
// when French ("Nouvelle partie", 15 chars vs "New game"'s 8) pushed the overlap
// to 35px. So: assert on ELEMENT geometry, never on the page's.
//
// What it verifies, per language:
//   1. The top bar survives every common phone width (320…640): the title is
//      neither truncated nor colliding with the toolbar, and the toolbar stays
//      on screen. Wrapping to a second line is an allowed outcome — below ~360px
//      the row does not fit in ANY language, English included.
//   2. Every value in the pack, rendered with realistic parameters into the real
//      element it appears in (hint card, win card, party overlay, status line),
//      fits its container without overflowing it or its card.
//   3. The live surfaces a player actually opens — board, settings modal,
//      leaderboard modal — have no overflowing control or label.
//   4. `<html lang>` resolves to the pack the browser locale asks for.
//
// Prereqs: static server on BASE_URL (default http://localhost:8000) and the
// environment's Playwright/Chromium (see board-helpers.mjs). Run with:
//
//   python3 -m http.server 8000 &
//   node tests/browser/i18n-layout.mjs

import { openGame, boardSettled } from './board-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.js';
const CHROMIUM = '/opt/pw-browsers/chromium';

// One locale per pack, so the browser resolves to it the way a real visitor does.
const LOCALES = [
  ['en-US', 'en'],
  ['de-DE', 'de'],
  ['fr-FR', 'fr'],
  ['es-ES', 'es'],
];
// 320 = the smallest phone still in use, 430 = the largest before the media
// query stops applying, 640 = the app's max-width.
const WIDTHS = [320, 360, 375, 390, 414, 430, 640];

const { I18N_PACKS } = await import('../../js/i18n.js');

let failed = false;
const check = (msg, ok) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failed = true;
};

// --- the strings, with parameters that produce their longest realistic form ---
function stringsFor(pack) {
  const call = (key, params) => {
    const v = pack[key];
    return typeof v === 'function' ? v(params || {}) : v;
  };
  const units = ['hint.unit.region', 'hint.unit.row', 'hint.unit.col'].map((k) => pack[k]);
  const bucket = call('bucket.label', { size: 12, difficulty: pack['difficulty.hard'] });
  const out = [];
  const add = (slot, key, text) => out.push({ slot, key, text: String(text) });

  // Hint card. Every unit word × both `many` branches × a two- and four-element
  // Hall set, because each combination builds a different sentence.
  for (const key of Object.keys(pack)) {
    if (!key.startsWith('hint.') || key.startsWith('hint.unit.')) continue;
    if (key.startsWith('hint.apply.')) {
      add('hint-apply', key, pack[key]);
      continue;
    }
    const slot = key.endsWith('.text') ? 'hint-text' : 'hint-title';
    if (typeof pack[key] !== 'function') {
      add(slot, key, pack[key]);
      continue;
    }
    for (const unit of units) {
      for (const many of [false, true]) {
        for (const k of [2, 4]) add(slot, key, call(key, { unit, many, k }));
      }
    }
  }
  add('hint-apply', 'hintcard.apply', pack['hintcard.apply']);

  // Win card: breakdown, the personal comparison in each of its branches, and
  // every submit/global status line.
  for (const [hints, mistakes] of [[0, 0], [1, 1], [3, 12]]) {
    add('win-time', 'win.breakdown', call('win.breakdown', { time: '12:34', hints, mistakes }));
    add('win-time', 'score.rowTitle', call('score.rowTitle', { time: '12:34', hints, mistakes }));
  }
  add('win-personal', 'win.personal.first', call('win.personal.first', { bucket }));
  add('win-personal', 'win.personal.best', pack['win.personal.best']);
  add('win-personal', 'win.personal.bestDetail', call('win.personal.bestDetail', { delta: '1:07', bucket }));
  add('win-personal', 'win.personal.rank', call('win.personal.rank', { rank: 3, total: 124 }));
  for (const capped of [false, true]) {
    add('win-personal', 'win.personal.percentile', call('win.personal.percentile', { percent: 88, total: 124, capped }));
  }
  for (const toBestKey of ['win.personal.toBest.equal', 'win.personal.toBest.delta']) {
    const toBest = call(toBestKey, { delta: '1:07' });
    add('win-personal', 'win.personal.detail', call('win.personal.detail', { bucket, toBest }));
    add('win-personal', 'win.personal.detailRank', call('win.personal.detailRank', { rank: 3, total: 124, bucket, toBest }));
  }
  for (const key of Object.keys(pack)) {
    if (!key.startsWith('submit.') && !key.startsWith('global.')) continue;
    add('win-submit-status', key, call(key, {
      attempt: 2, total: 250, rank: 17, percent: 92,
      reason: 'rate limited', text: call('submit.reject.generic', {}),
    }));
  }
  for (const key of ['win.submit', 'win.save', 'win.retry', 'win.newGame']) add('win-submit', key, pack[key]);

  add('party-text', 'party.text', pack['party.text']);
  add('party-close', 'party.close', pack['party.close']);
  for (const key of ['msg.almost', 'check.errors', 'check.ok']) add('msg', key, pack[key]);
  return out;
}

// --- in-page probes ---------------------------------------------------------
const MEASURE = (items) => {
  const SLOTS = {
    'hint-title': '#hint-title', 'hint-text': '#hint-text', 'hint-apply': '#hint-apply',
    'win-time': '#win-time', 'win-personal': '#win-personal',
    'win-submit-status': '#win-submit-status', 'win-submit': '#win-submit',
    'party-text': '.party-text', 'party-close': '#party-close', msg: '#message',
  };
  for (const id of ['hint-card', 'win-overlay', 'party-overlay']) {
    const el = document.getElementById(id);
    if (el) el.hidden = false;
  }
  const bad = [];
  for (const it of items) {
    const el = document.querySelector(SLOTS[it.slot]);
    if (!el) {
      bad.push({ ...it, why: `slot "${it.slot}" not in the DOM` });
      continue;
    }
    el.textContent = it.text;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      bad.push({ ...it, why: `${el.scrollWidth}px of text in a ${el.clientWidth}px box` });
      continue;
    }
    // A nowrap button overflows its PARENT, not itself.
    const card = el.closest('.hint-card, .party-card, .settings-modal');
    if (card && card.scrollWidth > card.clientWidth + 1) {
      bad.push({ ...it, why: `card overflows (${card.scrollWidth} > ${card.clientWidth})` });
    }
  }
  return bad;
};

const LIVE_PROBE = () => {
  const out = [];
  const seen = new Set();
  const sel = 'button, label, h1, h2, h3, .field-hint, option, .score-tab, .win-personal-main';
  for (const el of document.querySelectorAll(sel)) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    if (!el.offsetParent && st.position !== 'fixed') continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const key = el.className + '|' + el.textContent.slice(0, 30);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${el.className || el.tagName} "${el.textContent.trim().slice(0, 40)}" (${el.scrollWidth}/${el.clientWidth})`);
    }
  }
  return out;
};

// The top bar's two failure modes, measured on the elements themselves.
const TOPBAR_PROBE = () => {
  const h1 = document.querySelector('.topbar h1');
  const tb = document.querySelector('.toolbar');
  const hb = h1.getBoundingClientRect();
  const tbb = tb.getBoundingClientRect();
  const sameRow = !(tbb.top >= hb.bottom - 1 || hb.top >= tbb.bottom - 1);
  return {
    truncated: h1.scrollWidth > h1.clientWidth + 1,
    collides: sameRow && Math.min(hb.right, tbb.right) - Math.max(hb.left, tbb.left) > 0,
    wrapped: !sameRow,
    offscreen: tbb.right > document.documentElement.clientWidth + 1 || tbb.left < -1,
  };
};

// --- 1) top bar across widths ------------------------------------------------
const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch({ executablePath: CHROMIUM });
try {
  for (const [locale, code] of LOCALES) {
    const notes = [];
    let ok = true;
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, locale });
      await page.goto(BASE_URL + '/index.html');
      await page.waitForSelector('html[data-i18n-ready]');
      await page.waitForTimeout(400);
      const r = await page.evaluate(TOPBAR_PROBE);
      const good = !r.truncated && !r.collides && !r.offscreen;
      if (!good) ok = false;
      notes.push(`${width}:${good ? (r.wrapped ? 'wrap' : 'fits') : `BAD(trunc=${r.truncated} collide=${r.collides} off=${r.offscreen})`}`);
      await page.close();
    }
    check(`[${code}] top bar — ${notes.join(' ')}`, ok);
  }
} catch (e) {
  check(`top-bar pass threw: ${e && e.message}`, false);
} finally {
  await browser.close();
}

// --- 2..4) strings, live surfaces and <html lang> ----------------------------
for (const [locale, code] of LOCALES) {
  let browser2;
  try {
    const opened = await openGame({ baseUrl: BASE_URL, locale });
    browser2 = opened.browser;
    const { page, errors } = opened;

    check(`[${code}] <html lang> resolves to "${code}"`, (await page.getAttribute('html', 'lang')) === code);

    await boardSettled(page);
    let live = await page.evaluate(LIVE_PROBE);
    await page.click('#open-settings');
    await page.waitForTimeout(300);
    live = live.concat(await page.evaluate(LIVE_PROBE));
    await page.click('#settings-close');
    await page.click('#open-leaderboard');
    await page.waitForTimeout(400);
    live = live.concat(await page.evaluate(LIVE_PROBE));
    await page.click('#lb-close').catch(() => {});
    check(`[${code}] live surfaces fit${live.length ? ' — ' + live.join('; ') : ''}`, live.length === 0);

    const items = stringsFor(I18N_PACKS[code]);
    const bad = await page.evaluate(MEASURE, items);
    check(
      `[${code}] ${items.length} rendered strings fit their containers` +
        (bad.length ? ` — ${bad.map((b) => `${b.key}: ${b.why}`).join('; ')}` : ''),
      bad.length === 0
    );

    if (errors.length) check(`[${code}] no console errors (got ${JSON.stringify(errors)})`, false);
  } catch (e) {
    check(`[${code}] threw: ${e && e.message}`, false);
  } finally {
    if (browser2) await browser2.close();
  }
}

console.log(failed ? '\ni18n-layout: FAILED' : '\ni18n-layout: all passed');
process.exit(failed ? 1 : 0);
