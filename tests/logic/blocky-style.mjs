// Pure-logic test for the 'blocky' region-growth style (see js/generator.js).
// Run with plain Node:
//
//   node tests/logic/blocky-style.mjs
//
// The style exists to reproduce a level look with straight borders, one big
// background colour and a few tiny compact ones — but a nicer-looking board is
// worthless if it breaks the invariants everything else relies on. So this
// asserts, for blocky boards, exactly what the project promises for every
// puzzle: the solution is unique, the rating is one the hint engine can explain
// (never level 3), and a player following only hints can finish it.
//
// It also guards the property the style was built for and that the uniqueness
// repair used to silently undo: above easy there is NO single-cell region — a
// one-cell colour is a free queen and the whole point of the floor is that the
// opening costs real reasoning.
import { generatePuzzle } from '../../js/generator.js';
import { countSolutions, difficultyLevel, nakedSingleReach } from '../../js/solver.js';
import { contiguous, solveByHints } from './lib/board-checks.mjs';

// [size, difficulty, howMany]. Kept small so CI stays quick; the style's shape
// statistics live in tools/compare-styles.mjs, not here.
const CASES = [
  [6, 'easy', 2],
  [7, 'medium', 2],
  [8, 'medium', 2],
  [7, 'hard', 2],
  [8, 'hard', 2],
  [9, 'hard', 1],
];

let failures = 0;
let checked = 0;

for (const [N, difficulty, count] of CASES) {
  for (let i = 0; i < count; i++) {
    const label = `${N}x${N} ${difficulty} #${i + 1}`;
    const puzzle = generatePuzzle(N, difficulty, { style: 'blocky', budgetMs: 3000 });
    const { region, solution } = puzzle;
    checked++;

    for (const problem of checkPuzzle(N, region, solution, difficulty)) {
      failures++;
      console.error(`FAIL ${label}: ${problem}`);
    }
  }
}

console.log(`\nblocky-style: ${checked} boards checked, ${failures} failures`);
process.exit(failures ? 1 : 0);

function checkPuzzle(N, region, solution, difficulty) {
  const problems = [];

  // Every region id must appear, and every region must be contiguous — the
  // segment growth claims runs of cells, so a bug there would show up as a
  // split colour rather than as an unsolvable board.
  const sizes = new Array(N).fill(0);
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const g = region[r][c];
      if (!(g >= 0 && g < N)) {
        problems.push(`region id ${g} out of range at ${r},${c}`);
        return problems;
      }
      sizes[g]++;
    }
  for (let g = 0; g < N; g++) {
    if (sizes[g] === 0) problems.push(`region ${g} is empty`);
    else if (!contiguous(N, region, g)) problems.push(`region ${g} is not contiguous`);
  }

  if (countSolutions(N, region, 3) !== 1) problems.push('solution is not unique');

  const level = difficultyLevel(N, region);
  if (level >= 3) problems.push(`rated level ${level} — hints cannot explain it`);

  // The floor only applies where it does not fight the difficulty: easy IS the
  // naked single, so it needs its forced opening and keeps single-cell regions.
  if (difficulty !== 'easy') {
    const tiny = sizes.filter((s) => s === 1).length;
    if (tiny > 0) problems.push(`${tiny} single-cell region(s) — the size floor was undone`);
    if (nakedSingleReach(N, region) === N)
      problems.push('whole board falls out of naked singles alone');
  }

  const solved = solveByHints(N, region, solution);
  if (!solved.ok) problems.push(`not hint-solvable: ${solved.reason}`);

  return problems;
}
