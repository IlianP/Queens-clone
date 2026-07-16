// Browser test for the "Prüfen" live-check message behaviour:
//
//   * The wording is "Es gibt Fehler" (not "einen Fehler") — it covers any
//     number of errors.
//   * With Live-Prüfung ON, a red error message is STICKY: it persists across
//     taps and only clears once the board is actually error-free. A green
//     message still clears on the next tap.
//   * With Live-Prüfung OFF, the red message is not kept around.
//
// Prereqs: static server on BASE_URL (default http://localhost:8000) and the
// environment's Playwright/Chromium (see board-helpers.mjs). Run with:
//
//   python3 -m http.server 8000 &
//   node tests/browser/live-check-sticky.mjs
//
// This test waits on the live-check delay (LIVE_CHECK_DELAY, 2s), so it's slow
// by design. Exits non-zero on failure.

import { openGame, boardSize, cellIndex, tapCell, placeQueen } from './board-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const LIVE_DELAY = 2000;

const { browser, page, errors } = await openGame(BASE_URL);
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL: ' + msg);
};

// The live status element: { hidden, kind: 'error'|'ok'|'', text }.
const status = () =>
  page.evaluate(() => {
    const e = document.getElementById('check-status');
    return {
      hidden: e.hidden,
      kind: e.classList.contains('error') ? 'error' : e.classList.contains('ok') ? 'ok' : '',
      text: e.textContent,
    };
  });

const setLiveCheck = (on) =>
  page.evaluate((v) => {
    const cb = document.getElementById('live-check');
    cb.checked = v;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  }, on);

try {
  const N = await boardSize(page);
  await setLiveCheck(true);

  // Create an error: two queens in the same row.
  await placeQueen(page, cellIndex(N, 0, 0));
  await placeQueen(page, cellIndex(N, 0, 2));

  // After the live delay the red message appears, with the new wording.
  await page.waitForTimeout(LIVE_DELAY + 400);
  let s = await status();
  if (s.hidden || s.kind !== 'error') fail(`expected red error after delay, got ${JSON.stringify(s)}`);
  if (!/Es gibt Fehler/.test(s.text)) fail(`wrong wording: "${s.text}"`);
  if (/einen Fehler/.test(s.text)) fail(`still says "einen Fehler": "${s.text}"`);

  // Sticky: tap an unrelated empty cell that does NOT resolve the error. The red
  // message must remain visible immediately (no vanish-on-tap), no delay wait.
  await tapCell(page, cellIndex(N, 4, 4)); // a dot, error still present
  s = await status();
  if (s.hidden || s.kind !== 'error') fail(`red should persist across a tap, got ${JSON.stringify(s)}`);

  // Resolve every error: remove the second queen (tap it away). Now error-free,
  // so the sticky red must clear (it hides, then green is armed after the delay).
  // Tap the conflicting queen until it's no longer a queen.
  for (let i = 0; i < 3; i++) {
    const st = await page.evaluate((idx) => document.querySelectorAll('.cell')[idx].dataset.state, cellIndex(N, 0, 2));
    if (st !== 'queen') break;
    await tapCell(page, cellIndex(N, 0, 2));
  }
  s = await status();
  if (s.kind === 'error' && !s.hidden) {
    // Board might still be in error if a lone off-solution queen remains. Clear
    // the first queen too so the board is genuinely error-free.
    for (let i = 0; i < 3; i++) {
      const st = await page.evaluate((idx) => document.querySelectorAll('.cell')[idx].dataset.state, cellIndex(N, 0, 0));
      if (st !== 'queen') break;
      await tapCell(page, cellIndex(N, 0, 0));
    }
    s = await status();
  }
  if (s.kind === 'error' && !s.hidden)
    fail(`red should clear once board is error-free, got ${JSON.stringify(s)}`);

  // Live OFF: even after showing a status, turning the option off hides it.
  await setLiveCheck(false);
  s = await status();
  if (!s.hidden) fail(`turning live-check off should hide the status, got ${JSON.stringify(s)}`);

  if (errors.length) fail('console/page errors: ' + errors.join(' | '));
  if (!failed) console.log(`PASS: live-check message is sticky-on-error and reworded (N=${N})`);
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
