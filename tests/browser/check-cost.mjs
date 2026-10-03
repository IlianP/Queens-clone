// Does "Prüfen" charge what it promises — once per board state, priced by size,
// and on every surface that shows the result?
//
// A check costs checkPenalty(N) = N seconds (js/highscores.js). The cases worth a
// browser test are the ones the diff can't show:
//   - an untouched board is free (the answer is known), and asking again about
//     an unchanged board is free (it tells nothing new) — like a repeated hint;
//   - a verdict is about the board it was asked for, so the next move clears
//     it (there is no live lamp any more — it was removed on purpose);
//   - the win card's arithmetic closes: result = raw time + 3N·hints + N·checks,
//     and the frozen clock reads exactly that;
//   - the price label follows the board size;
//   - the longer "(+14 s)" label fits the action row at phone widths.
//
// Start a static server first: python3 -m http.server 8000
// Run: node tests/browser/check-cost.mjs

import { openGame, tapCell } from './board-helpers.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
let failed = false;
function ok(cond, msg) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed = true;
}
const eq = (got, want, msg) => ok(got === want, `${msg} (got ${JSON.stringify(got)})`);
const clock = (page) =>
  page.$eval('#timer', (el) => {
    const [m, s] = el.textContent.split(':');
    return Number(m) * 60 + Number(s);
  });
const secs = (mmss) => {
  const [m, s] = mmss.split(':');
  return Number(m) * 60 + Number(s);
};

async function solveViaHints(page) {
  for (let i = 0; i < 400; i++) {
    if (await page.evaluate(() => !document.getElementById('win-overlay').hidden)) return true;
    await page.click('#hint');
    if (await page.evaluate(() => document.getElementById('hint-apply').hidden)) {
      await page.click('#hint-close');
      break;
    }
    await page.click('#hint-apply');
    await page.waitForTimeout(15);
  }
  return page.evaluate(() => !document.getElementById('win-overlay').hidden);
}

// Pinned to 8×8 so the prices are known (check 8 s, hint 24 s) whatever the default becomes.
const storage = {
  'queens-clone-settings': JSON.stringify({ size: 8, difficulty: 'medium', introAnimation: false }),
};

// Section 1 clicks "Eintragen", which submits to the global leaderboard. Left
// unstubbed that is a real write to the live project (and, where a proxy breaks
// the certificate, an intermittent "no console errors" failure). Answer every
// leaderboard RPC locally; the play counters keep openGame's own stub.
const stubLeaderboard = (page) =>
  page.route('**/rest/v1/rpc/*', (route) => {
    const url = route.request().url();
    if (url.endsWith('/bump_stat')) return route.fallback();
    const body = url.endsWith('/submit_score') ? [{ rank: 1, total: 1 }] : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

// --- 1) button: price label, free cases, charged cases, win-card arithmetic ---
{
  const { browser, page, errors } = await openGame({ baseUrl: BASE, locale: 'de-DE', storage, routes: stubLeaderboard });
  try {
    const label = await page.$eval('#check', (el) => el.textContent);
    ok(/\+8\s?s/.test(label), `the check button announces 8 s on an 8×8: "${label}"`);
    ok(/8/.test(await page.$eval('#check', (el) => el.title)), 'its title spells the rule out');

    let before = await clock(page);
    await page.click('#check');
    await page.waitForTimeout(300);
    ok((await clock(page)) - before <= 1, 'checking an untouched board is free');

    await tapCell(page, 0); // a dot — now there is something to vouch for
    before = await clock(page);
    await page.click('#check');
    const flew = await page
      .waitForSelector('#cost-fly:not([hidden])', { timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    ok(flew, 'a charged check flies a pill');
    ok(/\+8/.test(await page.$eval('#cost-fly', (el) => el.textContent)), 'the pill quotes 8 s');
    let after = await clock(page);
    ok(after - before >= 8 && after - before <= 9, `the clock takes 8 s live (${before} -> ${after})`);
    await page.waitForFunction(() => document.getElementById('cost-fly').hidden, null, { timeout: 4000 });

    before = await clock(page);
    await page.click('#check');
    await page.waitForTimeout(400);
    ok((await clock(page)) - before <= 1, 'checking the same board again is free');
    eq(await page.$eval('#cost-fly', (el) => el.hidden), true, '… and flies nothing');

    ok(!(await page.$eval('#check-status', (el) => el.hidden)), 'the verdict is showing');
    await tapCell(page, 0); // dot → queen: a new board state
    eq(await page.$eval('#check-status', (el) => el.hidden), true, 'the next move clears the verdict');
    ok(!(await page.$('#live-check')), 'there is no live-check switch any more');
    before = await clock(page);
    await page.click('#check');
    after = await clock(page);
    ok(after - before >= 8 && after - before <= 9, `a changed board costs again (${before} -> ${after})`);

    // Undo back to the empty board, then solve it with hints: two checks on the
    // bill, and every figure on the win card has to agree.
    await tapCell(page, 0);
    ok(await solveViaHints(page), 'solved the board by applying hints');
    const frozen = await clock(page);
    const card = await page.evaluate(() => ({
      score: document.querySelector('#win-time .win-score').textContent,
      breakdown: document.querySelector('#win-time .win-breakdown').textContent,
    }));
    const hints = Number(card.breakdown.match(/(\d+)\s*Tipp/)[1]);
    const checksM = card.breakdown.match(/(\d+)\s*Prüfung/);
    eq(checksM && Number(checksM[1]), 2, `the breakdown counts both checks: "${card.breakdown}"`);
    const raw = secs(card.breakdown.match(/Spielzeit\s+(\d+:\d\d)/)[1]);
    eq(secs(card.score), raw + 24 * hints + 8 * 2, 'result = playing time + 24·hints + 8·checks');
    ok(/Prüfungen \(\+0:16\)/.test(card.breakdown), 'the check surcharge is named (+0:16)');
    eq(secs(card.score), frozen, 'the frozen clock reads exactly the result');

    // The local list stores the count and recomputes the same score.
    await page.click('#win-submit');
    await page.waitForTimeout(300);
    const entry = await page.evaluate(() => {
      const all = JSON.parse(localStorage.getItem('queens-clone-highscores') || '{}');
      return (all['8-medium'] || [])[0] || null;
    });
    ok(entry && entry.checks === 2, `the local entry keeps checks = 2 (${JSON.stringify(entry)})`);
    ok(entry && entry.score === secs(card.score), 'and the same score');

    ok(errors.length === 0, `no console errors (${errors.join(' | ') || 'none'})`);
  } finally {
    await browser.close();
  }
}

// The price follows the board size.
{
  const twelve = {
    'queens-clone-settings': JSON.stringify({ size: 12, difficulty: 'hard', introAnimation: false }),
  };
  const { browser, page } = await openGame({ baseUrl: BASE, locale: 'de-DE', storage: twelve, routes: stubLeaderboard });
  try {
    const label = await page.$eval('#check', (el) => el.textContent);
    ok(/\+12\s?s/.test(label), `the price follows the board: "${label}"`);
  } finally {
    await browser.close();
  }
}

// --- 3) layout: the longest label ("(+14 s)") in every pack, phone widths ------
for (const locale of ['de-DE', 'fr-FR', 'ru-RU', 'pt-BR', 'es-ES', 'en-US']) {
  const big = {
    'queens-clone-settings': JSON.stringify({ size: 14, difficulty: 'hard', introAnimation: false }),
  };
  const { browser, page } = await openGame({ baseUrl: BASE, locale, storage: big, routes: stubLeaderboard });
  try {
    for (const [w, h] of [[320, 640], [390, 844], [430, 932], [740, 420]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(120);
      const m = await page.evaluate(() =>
        ['check', 'hint'].map((id) => {
          const el = document.getElementById(id);
          const r = el.getBoundingClientRect();
          return { id, scroll: el.scrollWidth, client: el.clientWidth, right: r.right };
        })
      );
      for (const b of m)
        ok(
          b.scroll <= b.client + 1 && b.right <= w + 1,
          `${locale} ${w}px: #${b.id} fits (${b.scroll} vs ${b.client})`
        );
    }
  } finally {
    await browser.close();
  }
}

console.log(failed ? 'check-cost: FAILED' : 'check-cost: all passed');
process.exit(failed ? 1 : 0);
