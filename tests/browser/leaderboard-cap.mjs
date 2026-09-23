// The per-player cap on the global list, as the player sees it.
//
//   python3 -m http.server 8000
//   node tests/browser/leaderboard-cap.mjs
//
// top_scores() now shows each player at most ceil(limit / players) of their
// best rows (docs/leaderboard-setup.sql, section 5; the arithmetic itself is
// pinned against a real Postgres in tests/sql/top-scores-cap.sql). The server
// reports the cap and how many rows it held back; this checks the one surface
// built on that — a note at the foot of the global list — because without it a
// regular watches half their entries disappear and reasonably assumes they were
// lost:
//
//   1. the note appears when the cap held rows back, and quotes both numbers;
//   2. it does NOT appear when the cap didn't bite, or against a server that
//      doesn't cap at all (an un-migrated project sends neither column);
//   3. it sits after the rows, so row numbering and the own-row highlight are
//      untouched;
//   4. it fits a 320px phone in the two longest packs without spilling sideways.
//
// Every RPC is stubbed; nothing here talks to the live project.
import { stubStats } from './board-helpers.mjs';

const PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.js';
const CHROMIUM = '/opt/pw-browsers/chromium';
const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

let failed = false;
const check = (msg, ok, extra = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}${extra ? ` ${extra}` : ''}`);
  if (!ok) failed = true;
};

const row = (name, score, extra) => ({
  name, seconds: score, hints: 0, mistakes: 0, score,
  created_at: '2026-09-01T10:00:00Z', ...extra,
});
// The measured shape, after the cap: Viel shows its 17 best, the rest held back.
const CAPPED = [
  ...Array.from({ length: 17 }, (_, i) => row('Viel', 100 + i, { per_player: 17, hidden: 17 })),
  row('Mittel', 118, { per_player: 17, hidden: 17 }),
  row('Neu', 141, { per_player: 17, hidden: 17 }),
].sort((a, b) => a.score - b.score);
const NOT_BITTEN = [row('Allein', 90, { per_player: 50, hidden: 0 })];
const LEGACY = [row('Alt', 90)];

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch({ executablePath: CHROMIUM });

async function openGlobal({ locale, width, rows, nickname = '' }) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, locale });
  await stubStats(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((nick) => {
    localStorage.setItem('queens-clone-settings', JSON.stringify({
      size: 8, difficulty: 'hard', quickMode: true, introAnimation: false, nickname: nick }));
  }, nickname);
  await page.route('**/rest/v1/**', (route) => {
    const url = route.request().url();
    let body = [];
    if (url.includes('top_scores')) body = rows;
    if (url.includes('score_counts')) body = [{ total: rows.length, recent: 0 }];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(BASE_URL + '/index.html');
  await page.waitForSelector('.cell', { timeout: 15000 });
  await page.click('#open-leaderboard');
  await page.waitForSelector('#leaderboard-overlay:not([hidden])', { timeout: 5000 });
  await page.click('#lb-tab-global');
  await page.waitForFunction((n) => document.querySelectorAll('#lb-scores .score-row').length === n,
    rows.length, { timeout: 8000 });
  return { page, errors };
}

try {
  // --- 1 + 3: the cap bit ---------------------------------------------------
  {
    const { page, errors } = await openGlobal({ locale: 'de-DE', width: 390, rows: CAPPED, nickname: 'neu' });
    const info = await page.evaluate(() => {
      const list = document.getElementById('lb-scores');
      const note = list.querySelector('.score-note');
      const kids = [...list.children];
      return {
        note: note ? note.textContent : null,
        noteIsLast: note ? kids[kids.length - 1] === note : false,
        lastRank: kids.filter((k) => k.classList.contains('score-row')).pop().querySelector('.score-rank').textContent,
        me: [...list.querySelectorAll('.score-row')].findIndex((r) => r.classList.contains('me')),
      };
    });
    check('the note appears when the cap held rows back', !!info.note, `"${info.note}"`);
    check('it quotes the cap', /17 Einträge pro Spieler/.test(info.note || ''));
    check('it quotes how many are hidden', /17 weitere ausgeblendet/.test(info.note || ''));
    check('it sits after the rows', info.noteIsLast);
    check('row numbering is untouched', info.lastRank === `${CAPPED.length}.`, `(last: ${info.lastRank})`);
    check('the own-row highlight still lands on its row',
      info.me === CAPPED.findIndex((r) => r.name === 'Neu'), `(index ${info.me})`);
    check('no page errors', errors.length === 0, errors[0] || '');
    await page.close();
  }

  // --- 2: no note where there is nothing to say ------------------------------
  for (const [label, rows] of [['a cap that did not bite', NOT_BITTEN], ['an un-migrated server', LEGACY]]) {
    const { page } = await openGlobal({ locale: 'de-DE', width: 390, rows });
    const has = await page.$('#lb-scores .score-note');
    check(`no note for ${label}`, !has);
    await page.close();
  }

  // --- 4: it fits the narrowest phone in the longest packs -------------------
  for (const locale of ['fr-FR', 'ru-RU', 'pt-BR']) {
    const { page } = await openGlobal({ locale, width: 320, rows: CAPPED });
    const fit = await page.evaluate(() => {
      const list = document.getElementById('lb-scores');
      const note = list.querySelector('.score-note');
      if (!note) return null;
      const n = note.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      return {
        text: note.textContent,
        inside: n.left >= l.left - 1 && n.right <= l.right + 1,
        listScrollsSideways: list.scrollWidth > list.clientWidth + 1,
      };
    });
    check(`[${locale}] the note fits at 320px`, !!fit && fit.inside && !fit.listScrollsSideways,
      fit ? `"${fit.text}"` : '(no note)');
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(failed ? '\nleaderboard-cap: FAILED' : '\nleaderboard-cap: all passed');
process.exit(failed ? 1 : 0);
