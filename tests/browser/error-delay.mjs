// Browser test: the board's error feedback (conflict highlighting + dead-unit
// outlines) must NOT appear the instant a queen is placed — an immediate
// row/column reaction can betray another queen's position. It is delayed
// (ERROR_MARK_DELAY in js/main.js, currently 500ms) so the player gets a beat
// to reason. This test places two queens in the same row and asserts the
// conflict marking is absent immediately but present after the delay.
//
// Prereqs: a static server on BASE_URL (default http://localhost:8000) and the
// environment's Playwright/Chromium (see board-helpers.mjs). Run with:
//
//   python3 -m http.server 8000 &
//   node tests/browser/error-delay.mjs
//
// Exits non-zero on failure.

import {
  openGame,
  boardSize,
  cellIndex,
  placeQueen,
  conflictCount,
} from './board-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

const { browser, page, errors } = await openGame(BASE_URL);
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL: ' + msg);
};

try {
  const N = await boardSize(page);

  // Two queens in row 0, columns 0 and 2 — same row is always a conflict, and
  // they're not king-adjacent so the conflict is purely the row rule.
  const okA = await placeQueen(page, cellIndex(N, 0, 0));
  const okB = await placeQueen(page, cellIndex(N, 0, 2));
  if (!okA || !okB) fail('could not place the two test queens');

  // Right after the second placement: no conflict marking yet.
  const immediate = await conflictCount(page);
  if (immediate !== 0) fail(`conflicts shown immediately (${immediate}), expected 0`);

  // After the delay elapses, the conflict marking appears.
  await page.waitForTimeout(650);
  const delayed = await conflictCount(page);
  if (delayed < 2) fail(`conflicts not shown after delay (${delayed}), expected >= 2`);

  if (errors.length) fail('console/page errors: ' + errors.join(' | '));

  if (!failed) console.log(`PASS: error feedback hidden immediately, shown after delay (N=${N})`);
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
