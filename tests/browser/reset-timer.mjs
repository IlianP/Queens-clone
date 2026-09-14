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

// A small easy board so the closing phase can actually be solved cell by cell,
// Debug mode so the solution can be read out of the debug export (that is what
// lets the solve use NO hints of its own — see phase 5), and no intro animation
// so the clock starts promptly.
const { browser, page, errors } = await openGame({
  baseUrl: BASE,
  locale: 'de-DE',
  storage: {
    'queens-clone-settings': JSON.stringify({
      size: 5,
      difficulty: 'easy',
      quickMode: true,
      introAnimation: false,
      debug: true,
    }),
  },
});
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });

try {
  const N = await boardSize(page);

  // The solution up front, from the debug export. Two phases need it: the wrong
  // queen below has to be *reliably* wrong (a queen that happens to sit right
  // wouldn't count as a mistake, and the assertion would pass or fail with the
  // draw), and phase 5 places the real queens from it.
  await page.click('#debug-copy');
  const solution = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).solution;
  ok(Array.isArray(solution) && solution.length === N, 'debug export handed over the solution');

  // --- 1. The clock survives a reset -------------------------------------
  // Put something on the board, let the clock run, then clear it. The queen goes
  // somewhere the solution does not have one, so `mistakes` bumps to exactly 1
  // and phase 5 can hold the counter to that number.
  await placeQueen(page, cellIndex(N, 0, (solution[0] + 1) % N));
  await page.waitForTimeout(3200);
  const before = await clock(page);
  ok(before >= 3, `clock ran before the reset (${before}s)`);
  ok((await marksOnBoard(page)) > 0, 'board carries marks before the reset');

  await page.click('#reset-board');
  const after = await clock(page);
  ok(after >= before, `clock did not rewind on reset (${before}s -> ${after}s)`);
  ok(after !== 0, 'clock is not back at 0:00');
  ok((await marksOnBoard(page)) === 0, 'reset still clears the board');
  ok(
    (await cellState(page, cellIndex(N, 0, (solution[0] + 1) % N))) === 'empty',
    'the placed queen is gone'
  );

  // And it keeps ticking afterwards — a frozen clock would be the same exploit
  // wearing a different hat.
  await page.waitForTimeout(2200);
  const later = await clock(page);
  ok(later > after, `clock keeps running after the reset (${after}s -> ${later}s)`);

  // --- 2. Undo still rewinds the reset ------------------------------------
  await page.click('#undo');
  ok((await marksOnBoard(page)) > 0, 'undo brings the cleared board back');
  await page.click('#reset-board');

  // --- 3. hintsUsed survives too ------------------------------------------
  // The clock shows elapsed + 30·hints, so it doubles as a live readout of
  // hintsUsed: a reset that kept the elapsed time but zeroed the hint counter
  // still rewinds it by half a minute. The board is empty here and the hint is
  // only read, never applied, so it stays empty — which is what makes phase 4
  // and phase 5 below say something exact.
  const preHint = await clock(page);
  await page.click('#hint');
  const withHint = await clock(page);
  ok(withHint >= preHint + 30, `hint surcharge is on the clock (${preHint}s -> ${withHint}s)`);
  await page.click('#hint-close');

  await page.click('#reset-board');
  const afterReset = await clock(page);
  ok(afterReset >= withHint, `hint surcharge survives the reset (${withHint}s -> ${afterReset}s)`);

  // --- 4. seenHints survives as well --------------------------------------
  // hintsUsed only bumps for a NEW deduction (seenHints, issue #37). The board
  // is byte-for-byte the one the hint above was computed on, so the same
  // deduction comes back — and must still be free. Were seenHints cleared by the
  // reset while hintsUsed was kept, this would charge a second 30 s for a hint
  // the player has already seen: the exploit's mirror image, overcharging
  // instead of undercharging.
  const preRepeat = await clock(page);
  await page.click('#hint');
  await page.waitForTimeout(300);
  const afterRepeat = await clock(page);
  ok(
    afterRepeat - preRepeat <= 1,
    `the same hint after a reset is still free (${preRepeat}s -> ${afterRepeat}s)`
  );
  await page.click('#hint-close');

  // --- 5. and the surviving hint still charges the HIGHSCORE ---------------
  // Everything above reads the clock, which is a display. The score written to
  // the top list is built from pendingWin (seconds + 30·hints), so the exploit is
  // only really closed if that figure carries the pre-reset hint as well.
  //
  // This solve uses exactly ONE hint, taken before a reset, and then places the
  // queens straight from the solution — no further hints — so the expected
  // result is exact rather than "at least": the win card must report 1 Tipp and
  // charge 30 s for it. Reading the solution out of the debug export is what
  // makes that possible; solving via the hint loop instead would be blind here,
  // because a cleared board re-derives the very same deductions and a zeroed
  // counter would simply re-charge them to the same total.
  for (let r = 0; r < N; r++) await placeQueen(page, cellIndex(N, r, solution[r]));
  const won = await page.waitForSelector('#win-overlay:not([hidden])', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  ok(won, 'solved the board from the solution, without further hints');

  const card = await page.evaluate(() => ({
    score: document.querySelector('#win-time .win-score').textContent,
    breakdown: document.querySelector('#win-time .win-breakdown').textContent,
  }));
  const secs = (mmss) => {
    const [m, s] = mmss.split(':');
    return Number(m) * 60 + Number(s);
  };
  // Parsed defensively: with the bug back, the breakdown names no hint at all
  // and a throwing regex would report as a crash rather than as this assertion.
  const hints = Number((card.breakdown.match(/(\d+)\s*Tipp/) || [0, 0])[1]);
  const rawMatch = card.breakdown.match(/Spielzeit\s+(\d+:\d\d)/);
  const raw = rawMatch ? secs(rawMatch[1]) : -1;

  // The two assertions that actually discriminate are about TIME, not counts.
  // A count cannot settle this: with the bug back, the reset clears seenHints as
  // well, so phase 4's repeat hint is charged afresh and the card still reports
  // "1 Tipp" — the right number for the wrong reason. The clock readings taken
  // before the reset are the honest yardstick, because time only moves forward.
  // Anchored to `before` — read BEFORE the first reset, so the bug cannot move
  // the yardstick itself (a reading taken after a reset is already zeroed on a
  // broken build, and the comparison would pass vacuously).
  ok(raw >= before, `the scored playing time keeps the seconds played before the reset (${raw}s >= ${before}s)`);
  ok(
    secs(card.score) >= before + 30,
    `the recorded score is at least "played before the reset + one hint" (${card.score} >= ${before + 30}s)`
  );
  // With those pinned, the arithmetic on the card closes as usual.
  ok(hints === 1, `the scored solve counts one hint, the one taken before the reset (got ${hints})`);
  ok(
    raw >= 0 && secs(card.score) === raw + 30 * hints,
    `the recorded score charges it: "${card.breakdown}" -> ${card.score}`
  );
  // The third counter startTimer() used to clear. Mistakes carry no penalty
  // (see CLAUDE.md), so this is about the count staying honest, not the score:
  // the wrong queen from phase 1 must still be on the record after two resets.
  const misses = Number((card.breakdown.match(/(\d+)\s*Fehler/) || [0, 0])[1]);
  ok(misses === 1, `the mistake made before the reset is still counted (got ${misses})`);

  ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
}

console.log(failed ? '\nFAILED' : '\nPASSED');
process.exit(failed ? 1 : 0);
