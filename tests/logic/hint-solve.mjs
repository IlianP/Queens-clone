// Pure-logic smoke test — no browser, no dependencies. Run with plain Node:
//
//   node tests/logic/hint-solve.mjs
//
// The invariant it guards is the one from CLAUDE.md: for every generated
// puzzle, a human following ONLY the hint engine must be able to solve it. So
// we generate puzzles and drive them exactly as a player would — repeatedly ask
// computeHint for the next deduction, apply it, and assert all N queens land on
// the puzzle's unique solution. If generator, solver and hint ever drift apart
// (a puzzle that needs a technique the hints don't offer), this loop stalls and
// the test fails loudly instead of shipping an unsolvable-by-hint board.
//
// This exercises the whole logic spine (generator → solver → hint → game rules)
// without any DOM, which is why it lives here and not under tests/browser.

import { generatePuzzle } from '../../js/generator.js';
import { computeHint } from '../../js/hint.js';

// Each entry is [size, difficulty, howManyPuzzles]. Size 12 is hard-only by
// design (see CLAUDE.md), so it appears only with 'hard'.
const CASES = [
  [6, 'easy', 3],
  [7, 'medium', 3],
  [8, 'medium', 3],
  [8, 'hard', 3],
  [9, 'hard', 2],
  [10, 'hard', 2],
];

let failures = 0;
let solved = 0;

for (const [N, difficulty, count] of CASES) {
  for (let i = 0; i < count; i++) {
    const puzzle = generatePuzzle(N, difficulty);
    const label = `${N}x${N} ${difficulty} #${i + 1}`;
    const result = solveByHints(N, puzzle);
    if (result.ok) {
      solved++;
    } else {
      failures++;
      console.error(`FAIL ${label}: ${result.reason}`);
    }
  }
}

console.log(`\n${solved} solved, ${failures} failed`);
process.exit(failures ? 1 : 0);

// Drive one puzzle to completion using only hints, mirroring how main.js feeds
// the engine: computeHint(N, region, solution, queens, manualMarks). 'place'
// hints set a queen, 'eliminate' hints set manual marks (which unlock the next
// naked single). We never apply a hint that contradicts the known solution — a
// correct engine should never suggest one, so if it does we fail.
function solveByHints(N, { region, solution }) {
  const queen = Array.from({ length: N }, () => Array(N).fill(false));
  const mark = Array.from({ length: N }, () => Array(N).fill(false));

  const collectQueens = () => {
    const out = [];
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) if (queen[r][c]) out.push([r, c]);
    return out;
  };
  const queenCount = () => collectQueens().length;

  // A generous ceiling: a solve needs O(N) placements plus eliminations; if we
  // blow past this we're looping without progress, which is itself the bug.
  const maxSteps = N * N * 4;

  for (let step = 0; step < maxSteps; step++) {
    if (queenCount() === N) break;
    const hint = computeHint(N, region, solution, collectQueens(), mark);

    if (hint.kind === 'place') {
      const [r, c] = hint.targetCells[0];
      if (solution[r] !== c)
        return { ok: false, reason: `hint placed a queen off-solution at ${r},${c}` };
      queen[r][c] = true;
      mark[r][c] = false;
    } else if (hint.kind === 'eliminate') {
      let progressed = false;
      for (const [r, c] of hint.targetCells) {
        if (!mark[r][c] && !queen[r][c]) {
          mark[r][c] = true;
          progressed = true;
        }
      }
      if (!progressed)
        return { ok: false, reason: 'eliminate hint marked nothing new (stalled)' };
    } else if (hint.kind === 'mistake') {
      return { ok: false, reason: `engine reported a mistake on a clean board: ${hint.title}` };
    } else {
      // kind === 'none'
      return { ok: false, reason: `no hint available with ${queenCount()}/${N} queens placed` };
    }
  }

  if (queenCount() !== N)
    return { ok: false, reason: `stalled at ${queenCount()}/${N} queens after ${maxSteps} steps` };

  // Final check: every queen must sit on the unique solution.
  for (let r = 0; r < N; r++) {
    const c = solution[r];
    if (!queen[r][c]) return { ok: false, reason: `row ${r} queen not on solution column ${c}` };
  }
  return { ok: true };
}
