// Browser test: the two touch-accuracy safeguards in js/main.js.
//
//   1. Axis lock — a swipe that sweeps across a row and then drifts sideways at
//      the very end must NOT dot the off-row cell it drifts onto; the stroke is
//      pinned to the row it swept.
//   2. Enlarged forced-cell target — when a row is dotted down to a single open
//      cell, that cell's tap target grows into its neighbours, so a near-miss on
//      the neighbour still lands on the forced cell. A tap clearly outside the
//      grown zone still acts on the neighbour itself.
//
// Quick mode is turned OFF for the forced-cell part so the signals stay clean:
// with auto-marks disabled, a tap that lands on the forced cell dots exactly
// that cell (nothing spreads), and a queen placed on a neighbour marks nothing
// else — so each assertion pins down exactly which cell received the tap.
//
// Prereqs: a static server on BASE_URL (default http://localhost:8000) and the
// environment's Playwright/Chromium (see board-helpers.mjs). Run with:
//
//   python3 -m http.server 8000 &
//   node tests/browser/touch-accuracy.mjs
//
// Exits non-zero on failure.

import {
  openGame,
  boardSize,
  cellIndex,
  cellState,
  cellRect,
  tapCell,
  swipe,
} from './board-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

const { browser, page, errors } = await openGame(BASE_URL);
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL: ' + msg);
};

async function waitForBoard() {
  await page.waitForSelector('.cell', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const c = document.querySelector('.cell');
      return c && c.dataset.state !== undefined;
    },
    { timeout: 15000 }
  );
}

// Raw tap at a viewport point (no cell-index helper, so we can aim off-centre).
async function tapPoint(x, y) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(40);
}

// Dot every cell of row 0 except column k, leaving (0,k) as the sole open cell
// in its row → forced. Assumes quick mode is off (one tap = one dot).
async function setupForcedRow(N, k) {
  for (let c = 0; c < N; c++) {
    if (c !== k) await tapCell(page, cellIndex(N, 0, c));
  }
}

try {
  const N = await boardSize(page);

  // ---- Safeguard #1: axis lock on a drifting row swipe (quick mode as-is) ----
  const rowPoints = [];
  for (let c = 0; c < N; c++) rowPoints.push(await cellRect(page, cellIndex(N, 0, c)));
  const driftTarget = await cellRect(page, cellIndex(N, 1, N - 1));
  const stroke = rowPoints.map((r) => ({ x: r.x, y: r.y }));
  stroke.push({ x: driftTarget.x, y: driftTarget.y }); // the sideways drift
  await swipe(page, stroke);

  let rowOk = true;
  for (let c = 0; c < N; c++) {
    if ((await cellState(page, cellIndex(N, 0, c))) !== 'dot') rowOk = false;
  }
  if (!rowOk) fail('axis lock: swept row 0 is not fully dotted');
  const drifted = await cellState(page, cellIndex(N, 1, N - 1));
  if (drifted !== 'empty') fail(`axis lock: drift cell (1,${N - 1}) was marked (${drifted}), expected empty`);
  let row1Clean = true;
  for (let c = 0; c < N; c++) {
    if ((await cellState(page, cellIndex(N, 1, c))) !== 'empty') row1Clean = false;
  }
  if (!row1Clean) fail('axis lock: row 1 has stray dots from the drift');

  // ---- Safeguard #2: enlarged target for the single forced cell ----
  // Turn quick mode off and reload so auto-marks don't muddy the signals.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('queens-clone-settings') || '{}');
    s.quickMode = false;
    localStorage.setItem('queens-clone-settings', JSON.stringify(s));
  });
  await page.reload();
  await waitForBoard();
  const N2 = await boardSize(page);
  const k = Math.floor(N2 / 2); // keep column k open

  // (a) A near-miss tap on the inner half of the left neighbour (nearest the
  // forced cell) is redirected onto (0,k): the forced cell — empty until now —
  // gets the dot, and the neighbour is left untouched.
  await setupForcedRow(N2, k);
  if ((await cellState(page, cellIndex(N2, 0, k))) !== 'empty') {
    fail('setup(a): forced cell (0,k) is not open');
  }
  let left = await cellRect(page, cellIndex(N2, 0, k - 1));
  await tapPoint(left.right - left.width * 0.15, left.y); // inner (right) half
  if ((await cellState(page, cellIndex(N2, 0, k))) !== 'dot') {
    fail('grown target: a near-miss tap did not land on the forced cell');
  }
  if ((await cellState(page, cellIndex(N2, 0, k - 1))) !== 'dot') {
    fail('grown target: the near-miss tap disturbed the neighbour');
  }

  // (b) A tap on the outer half of the neighbour is outside the grown zone, so
  // it acts on the neighbour itself (its dot cycles to a queen) and never
  // touches the forced cell.
  await page.click('#reset-board');
  await page.waitForTimeout(40);
  await setupForcedRow(N2, k);
  if ((await cellState(page, cellIndex(N2, 0, k))) !== 'empty') {
    fail('setup(b): forced cell (0,k) is not open');
  }
  left = await cellRect(page, cellIndex(N2, 0, k - 1));
  await tapPoint(left.left + left.width * 0.15, left.y); // outer (left) half
  if ((await cellState(page, cellIndex(N2, 0, k - 1))) !== 'queen') {
    fail('grown target: a far tap on the neighbour did not act on the neighbour');
  }
  if ((await cellState(page, cellIndex(N2, 0, k))) !== 'empty') {
    fail('grown target: a far tap on the neighbour wrongly hijacked the forced cell');
  }

  if (errors.length) fail('console/page errors: ' + errors.join(' | '));

  if (!failed) console.log(`PASS: axis lock + enlarged forced-cell target (N=${N})`);
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
