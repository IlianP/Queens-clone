// Does "Zurücksetzen" keep the attempt running, or does it hand out a free run?
//
// Clearing the board used to call startTimer(), which is the NEW-board entry
// point: it zeroed the clock, hintsUsed, seenHints and mistakes. That turned the
// button into a highscore cheat — play a board almost to the end, memorise where
// the queens sit, reset, and replay the solution against a clock starting at
// 0:00 for a time no honest solve can reach. (It also laundered the hint
// surcharge: three hints taken, reset, score as if none were.)
//
// The fix is a subtraction, which is exactly the kind of change that silently
// comes back: any future refactor that routes reset through startTimer() again
// re-opens it, and nothing else in the app would notice. Hence this test.
//
// Start a static server first: python3 -m http.server 8000
// Run: node tests/browser/reset-timer.mjs

import { openGame, boardSize, cellIndex, cellState, placeQueen } from './board-helpers.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
let failed = false;
function ok(cond, msg) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed = true;
}

// The clock as seconds — it renders the EFFECTIVE time (elapsed + hint
// surcharge), which is precisely the figure the exploit was resetting.
const clock = (page) =>
  page.$eval('#timer', (el) => {
    const [m, s] = el.textContent.split(':');
    return Number(m) * 60 + Number(s);
  });

// Queens and dots currently on the board.
const marksOnBoard = (page) =>
  page.$$eval('.cell', (cs) => cs.filter((c) => c.dataset.state !== 'empty').length);

const { browser, page, errors } = await openGame({ baseUrl: BASE, locale: 'de-DE' });

try {
  const N = await boardSize(page);

  // --- 1. The clock survives a reset -------------------------------------
  // Put something on the board, let the clock run, then clear it.
  await placeQueen(page, cellIndex(N, 0, 0));
  await page.waitForTimeout(3200);
  const before = await clock(page);
  ok(before >= 3, `clock ran before the reset (${before}s)`);
  ok((await marksOnBoard(page)) > 0, 'board carries marks before the reset');

  await page.click('#reset-board');
  const after = await clock(page);
  ok(after >= before, `clock did not rewind on reset (${before}s -> ${after}s)`);
  ok(after !== 0, 'clock is not back at 0:00');
  ok((await marksOnBoard(page)) === 0, 'reset still clears the board');
  ok((await cellState(page, cellIndex(N, 0, 0))) === 'empty', 'the placed queen is gone');

  // And it keeps ticking afterwards — a frozen clock would be the same exploit
  // wearing a different hat.
  await page.waitForTimeout(2200);
  const later = await clock(page);
  ok(later > after, `clock keeps running after the reset (${after}s -> ${later}s)`);

  // --- 2. Undo still rewinds the reset ------------------------------------
  await page.click('#undo');
  ok((await marksOnBoard(page)) > 0, 'undo brings the cleared board back');
  await page.click('#reset-board');

  // --- 3. The hint surcharge survives too ---------------------------------
  // The clock shows elapsed + 30·hints, so a reset that kept the elapsed time
  // but zeroed hintsUsed would still visibly rewind it by half a minute.
  const preHint = await clock(page);
  await page.click('#hint');
  const withHint = await clock(page);
  ok(withHint >= preHint + 30, `hint surcharge is on the clock (${preHint}s -> ${withHint}s)`);
  await page.click('#hint-close');

  await page.click('#reset-board');
  const afterReset = await clock(page);
  ok(afterReset >= withHint, `hint surcharge survives the reset (${withHint}s -> ${afterReset}s)`);

  ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
}

console.log(failed ? '\nFAILED' : '\nPASSED');
process.exit(failed ? 1 : 0);
