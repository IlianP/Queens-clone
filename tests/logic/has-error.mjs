// Pure-logic checks for Game.hasError(solution) — the yes/no behind the
// "Prüfen" status and the live lamp. No browser, no deps:
//   node tests/logic/has-error.mjs
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

// region[r][c] = r → each row is its own colour region. Simple, valid boards.
const rowsAsRegions = (N) => Array.from({ length: N }, (_, r) => new Array(N).fill(r));

// --- A pristine board is error-free. ---
{
  const g = new Game(5, rowsAsRegions(5), false);
  const solution = [0, 2, 4, 1, 3];
  check('pristine board → no error', g.hasError(solution) === false);
}

// --- A queen on its solution cell is fine. ---
{
  const g = new Game(5, rowsAsRegions(5), false);
  const solution = [0, 2, 4, 1, 3];
  g.queen[0][0] = true;
  g.queenCount = 1;
  check('queen on solution cell → no error', g.hasError(solution) === false);
}

// --- A queen off the solution is an error (existing behaviour). ---
{
  const g = new Game(5, rowsAsRegions(5), false);
  const solution = [0, 2, 4, 1, 3];
  g.queen[0][1] = true; // solution[0] === 0, not 1
  g.queenCount = 1;
  check('queen off solution → error', g.hasError(solution) === true);
}

// --- NEW: a manual dot on a solution cell is an error even when no unit is
// dead yet. This is the case the "Prüfen" check used to miss while the hint
// already flagged it ("Hier muss eine Dame stehen"). ---
{
  const g = new Game(5, rowsAsRegions(5), false);
  const solution = [0, 2, 4, 1, 3];
  g.mark[2][4] = true; // solution[2] === 4 → a queen must go here
  // Row 2 / region 2 still have other open cells, so this is NOT a dead unit.
  check('dot on solution cell → error', g.hasError(solution) === true);
}

// --- A dot on a NON-solution cell is legitimate (players exclude cells). ---
{
  const g = new Game(5, rowsAsRegions(5), false);
  const solution = [0, 2, 4, 1, 3];
  g.mark[2][0] = true; // solution[2] === 4, so excluding (2,0) is fine
  check('dot on non-solution cell → no error', g.hasError(solution) === false);
}

// --- Without a solution, only rules apply: a dot on a solution cell is NOT an
// error (there's no solution to compare against). ---
{
  const g = new Game(5, rowsAsRegions(5), false);
  g.mark[2][4] = true;
  check('rules-only (no solution) → dot alone is no error', g.hasError() === false);
}

// --- Regression from a real reported board (debug state, 2026-07-20):
// two correct queens, no conflicts, no dead unit, but cell (4,2) — a solution
// cell (solution[4] === 2) — is marked as an exclusion. "Prüfen" said "Keine
// Fehler" while the hint said a queen must stand there. Now it's an error. ---
{
  const region = [
    [2, 0, 0, 0, 0, 1, 1, 3, 3, 3, 3],
    [2, 2, 0, 0, 0, 1, 1, 3, 3, 3, 3],
    [2, 2, 2, 2, 2, 2, 1, 1, 1, 3, 3],
    [2, 2, 2, 2, 2, 2, 1, 3, 3, 3, 3],
    [2, 2, 4, 2, 2, 1, 1, 5, 5, 6, 3],
    [4, 4, 4, 4, 4, 1, 5, 5, 5, 6, 3],
    [4, 4, 4, 8, 8, 1, 1, 5, 5, 6, 6],
    [4, 4, 4, 8, 5, 5, 5, 5, 7, 7, 7],
    [8, 8, 8, 8, 8, 5, 7, 5, 7, 7, 7],
    [8, 8, 8, 8, 8, 8, 7, 7, 7, 9, 7],
    [8, 8, 10, 10, 9, 9, 9, 9, 9, 9, 9],
  ];
  const solution = [1, 5, 0, 7, 2, 6, 10, 8, 4, 9, 3];
  const g = new Game(11, region, true);
  g.queen[6][10] = true;
  g.queen[9][9] = true;
  g.queenCount = 2;
  const marks = [
    [0, 4], [0, 6], [1, 4], [1, 6], [2, 5], [2, 6], [2, 7], [2, 8], [3, 5],
    [3, 6], [4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [5, 5],
    [5, 6], [5, 7], [5, 8], [7, 0], [7, 1], [7, 2], [7, 4], [7, 5], [7, 6],
    [7, 7], [8, 5], [8, 7], [10, 0], [10, 1], [10, 4], [10, 5], [10, 6],
    [10, 7], [10, 8], [10, 9], [10, 10],
  ];
  for (const [r, c] of marks) g.mark[r][c] = true;
  check('reported board → dot on (4,2) is now an error', g.hasError(solution) === true);
  // And no conflicts / no dead unit — proving the new dot check is what catches it.
  check('reported board → no rule violation on its own', g.conflicts().size === 0);
}

console.log(failed === 0 ? '\nhas-error: all passed' : `\nhas-error: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
