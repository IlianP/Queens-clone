// Pure-logic test for the 'strips' region-growth style (see js/generator.js).
// Run with plain Node:
//
//   node tests/logic/strips-style.mjs
//
// The style reproduces a LinkedIn board on which N-1 of the N colours were
// straight, one-cell-wide segments and the last one was a single background
// region covering most of the grid. As with blocky, a nicer-looking board is
// worthless if it breaks an invariant, so this asserts what the project
// promises for every puzzle — unique solution, a rating the hint engine can
// explain (never level 3), finishable by following hints alone — plus the three
// properties this style is *made of* and that its uniqueness repair could
// silently undo:
//
//   1. exactly one region is not a strip (the background),
//   2. no single-cell region (the size floor), and
//   3. the background is the biggest region by a clear margin.
//
// (1) is the one that matters: `makeUnique`, the repair the other two styles
// use, buys uniqueness by moving a cell into an arbitrary neighbouring region,
// which bends a segment into an L. That is why the strips style has a repair of
// its own — and why a refactor routing it back through the shared one has to
// fail here rather than ship boards that merely look a bit less deliberate.
import { generatePuzzle } from '../../js/generator.js';
import { countSolutions, difficultyLevel } from '../../js/solver.js';
import { contiguous, regionShapes, solveByHints } from './lib/board-checks.mjs';

// [size, difficulty, howMany]. No easy case: the style has no easy boards by
// construction (see stripCoverage in js/generator.js), which `checkDifficulty`
// below asserts instead of pretending otherwise.
const CASES = [
  [6, 'medium', 2],
  [7, 'medium', 2],
  [8, 'medium', 2],
  [7, 'hard', 2],
  [8, 'hard', 2],
  [10, 'hard', 1],
];

let failures = 0;
let checked = 0;

for (const [N, difficulty, count] of CASES) {
  for (let i = 0; i < count; i++) {
    const label = `${N}x${N} ${difficulty} #${i + 1}`;
    const puzzle = generatePuzzle(N, difficulty, { style: 'strips', budgetMs: 3000 });
    checked++;
    for (const problem of checkPuzzle(N, puzzle.region, puzzle.solution)) {
      failures++;
      console.error(`FAIL ${label}: ${problem}`);
    }
  }
}

// Asking for easy must not throw, hang, or hand back a mislabelled board: it
// comes back honestly rated one level up. Guarded here because it is the one
// caller mistake the style invites, and the pool builder relies on the rating.
{
  const p = generatePuzzle(7, 'easy', { style: 'strips', budgetMs: 2000 });
  checked++;
  if (p.level === 0) {
    failures++;
    console.error('FAIL easy request: rated easy — the style is supposed to have none');
  }
  for (const problem of checkPuzzle(7, p.region, p.solution)) {
    failures++;
    console.error(`FAIL easy request: ${problem}`);
  }
}

console.log(`\nstrips-style: ${checked} boards checked, ${failures} failures`);
process.exit(failures ? 1 : 0);

function checkPuzzle(N, region, solution) {
  const problems = [];

  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const g = region[r][c];
      if (!(g >= 0 && g < N)) {
        problems.push(`region id ${g} out of range at ${r},${c}`);
        return problems;
      }
    }
  const { sizes, strips, stripCount } = regionShapes(N, region);
  for (let g = 0; g < N; g++) {
    if (sizes[g] === 0) problems.push(`region ${g} is empty`);
    else if (!contiguous(N, region, g)) problems.push(`region ${g} is not contiguous`);
  }

  // (1) the shape invariant: every colour but one is a straight segment.
  if (stripCount !== N - 1)
    problems.push(`${stripCount} strip-shaped regions, expected ${N - 1} (repair bent a segment?)`);

  // (2) the size floor — a one-cell colour is a free queen.
  const tiny = sizes.filter((s) => s === 1).length;
  if (tiny > 0) problems.push(`${tiny} single-cell region(s) — the size floor was undone`);

  // (3) the background is the one non-strip region, and it dominates. The share
  // is left loose on purpose (it drifts up with N, see stripCoverage); what is
  // asserted is that ONE region is the background, not a particular percentage.
  const backgrounds = [];
  for (let g = 0; g < N; g++) if (!strips[g]) backgrounds.push(g);
  if (backgrounds.length === 1) {
    const bg = backgrounds[0];
    const biggest = Math.max(...sizes);
    if (sizes[bg] !== biggest)
      problems.push(`background region ${bg} (${sizes[bg]}) is not the biggest (${biggest})`);
    if (sizes[bg] < 0.25 * N * N)
      problems.push(`background covers only ${((100 * sizes[bg]) / (N * N)).toFixed(0)}% of the board`);
  }

  if (countSolutions(N, region, 3) !== 1) problems.push('solution is not unique');

  const level = difficultyLevel(N, region);
  if (level >= 3) problems.push(`rated level ${level} — hints cannot explain it`);

  const solved = solveByHints(N, region, solution);
  if (!solved.ok) problems.push(`not hint-solvable: ${solved.reason}`);

  return problems;
}
