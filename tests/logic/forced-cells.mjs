// Pure-logic checks for Game.forcedCells() — the "only open cell left in a
// unit" detector behind the enlarged-tap-target safeguard. No browser, no deps:
//   node tests/logic/forced-cells.mjs
import { Game } from '../../js/game.js';

let failed = 0;
function check(name, cond) {
  if (cond) {
    console.log('  ok   ' + name);
  } else {
    console.log('  FAIL ' + name);
    failed++;
  }
}
const keys = (set) => [...set].sort().join(' ');

// region[r][c] = r → each row is its own region, so a "row" single and a
// "region" single coincide on the same cell (no accidental extra singles).
const rowsAsRegions = (N) => Array.from({ length: N }, (_, r) => new Array(N).fill(r));

// --- A fresh board forces nothing: every unit still has N open cells. ---
{
  const g = new Game(5, rowsAsRegions(5), false);
  check('fresh board → no forced cells', g.forcedCells().size === 0);
}

// --- A row dotted down to a single gap forces that gap. ---
{
  const g = new Game(5, rowsAsRegions(5), false);
  for (const c of [0, 1, 2, 4]) g.mark[0][c] = true; // leave (0,3) open
  check('row with one gap → that cell is forced', keys(g.forcedCells()) === '0,3');
}

// --- A placed queen is not a forced "open" cell; its unit is excluded. ---
{
  const g = new Game(5, rowsAsRegions(5), false);
  g.queen[0][3] = true;
  g.queenCount = 1;
  // Row 0 now holds a queen, so even with the rest dotted it must not be forced.
  for (const c of [0, 1, 2, 4]) g.mark[0][c] = true;
  check('unit with a queen → not forced', g.forcedCells().size === 0);
}

// --- Quick-mode auto-marks close cells too (combined with manual marks). ---
{
  const g = new Game(5, rowsAsRegions(5), true);
  g.queen[0][0] = true; // auto-marks row 0, col 0, region 0, and (1,1)
  g.queenCount = 1;
  // Row 1: (1,0) auto (col+touch), (1,1) auto (touch). Dot (1,2),(1,3) by hand;
  // (1,4) is the last open cell → forced (row 1 == region 1, same cell).
  g.mark[1][2] = true;
  g.mark[1][3] = true;
  check('auto-marks + manual marks → last open cell forced', keys(g.forcedCells()) === '1,4');
}

// --- A column reduced to one open cell is forced (independent of rows). ---
{
  // region[r][c] = c → each column is its own region, so a column single and a
  // region single land on the same cell (no accidental extra singles).
  const region = Array.from({ length: 5 }, () => Array.from({ length: 5 }, (_, c) => c));
  const g = new Game(5, region, false);
  for (const r of [0, 1, 3, 4]) g.mark[r][2] = true; // column 2 open only at (2,2)
  check('column with one gap → that cell is forced', keys(g.forcedCells()) === '2,2');
}

console.log(failed === 0 ? '\nforced-cells: all passed' : `\nforced-cells: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
