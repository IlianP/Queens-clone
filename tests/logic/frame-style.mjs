// Pure-logic test for the 'frame' region-growth style (see js/generator.js).
// Run with plain Node:
//
//   node tests/logic/frame-style.mjs
//
// The style reproduces the look of the fourth reference screenshot: a few
// regions own the board's outer ring and reach inward, while the rest sit
// landlocked in the middle. It is the newest shipped style, so this asserts the
// same thing its two predecessors do — a nicer-looking board is worthless if it
// breaks the invariants everything else relies on — plus the two properties
// that are specific to it and that nothing else would notice regressing:
//
//   1. The look itself. `edgeBound` is what separates this style from every
//      other one (0.40-0.47 against organic's 0.86-0.90), and it is produced by
//      two easily-lost details in growRegionsFrame: the outer regions claim the
//      WHOLE ring before the area budget applies, and a placement with more
//      ring queens than outer regions is rejected outright. Drop either and the
//      boards stay valid, stay contiguous, stay unique — and quietly stop
//      looking like the screenshot. That is exactly the regression
//      `makeUniqueStrips` exists to prevent one style over.
//   2. The size ceiling is real. Above FRAME_MAX_SIZE the uniqueness repair
//      stops finishing, so `stylesFor` / `mixFor` must not offer it there. The
//      test pins the rule rather than the timing, because timing on CI is noise.
import { generatePuzzle } from '../../js/generator.js';
import { countSolutions, difficultyLevel } from '../../js/solver.js';
import { boardShape } from '../../tools/lib/board-metrics.mjs';
import { frameLike } from '../../tools/lib/references.mjs';
import { contiguous, solveByHints } from './lib/board-checks.mjs';

// [size, difficulty, howMany]. Kept small so CI stays quick; the style's shape
// statistics live in tools/compare-styles.mjs, not here.
const CASES = [
  [6, 'easy', 2],
  [7, 'medium', 2],
  [8, 'medium', 2],
  [7, 'hard', 2],
  [8, 'hard', 2],
];

let failures = 0;
let checked = 0;
const shapes = [];
const fail = (msg) => {
  console.error(`FAIL  ${msg}`);
  failures++;
};

for (const [N, difficulty, count] of CASES) {
  for (let i = 0; i < count; i++) {
    const label = `${N}x${N} ${difficulty} #${i + 1}`;
    const puzzle = generatePuzzle(N, difficulty, { style: 'frame', budgetMs: 4000 });
    const { region, solution } = puzzle;
    checked++;

    // A board grown by the fallback is not a frame board, and asserting the
    // frame look on one would be asserting it on organic growth.
    if (puzzle.grownWith !== 'frame') {
      fail(`${label}: grown by '${puzzle.grownWith}', not by the requested style`);
      continue;
    }

    for (let g = 0; g < N; g++)
      if (!contiguous(N, region, g)) fail(`${label}: region ${g} is not contiguous`);
    if (countSolutions(N, region, 200000) !== 1) fail(`${label}: solution is not unique`);

    const level = difficultyLevel(N, region);
    if (level >= 3) fail(`${label}: rated ${level} — no hint could explain it`);

    const solved = solveByHints(N, region, solution);
    if (!solved.ok) fail(`${label}: not solvable by hints — ${solved.reason}`);

    shapes.push({ label, N, m: boardShape(N, region) });
  }
}

// The look, over the sample rather than per board: the signature is a per-board
// yes/no and a single board may legitimately miss it (measured hit rates run
// 30% at 7x7 hard to 99% at 8x8 easy — see docs/board-styles.md). What must
// hold is that these boards are nothing like the other styles' on the axis the
// style is about, so the assertion is on the MEAN edgeBound, well clear of both
// organic (0.86-0.90) and the frameLike threshold.
if (shapes.length) {
  const meanEdge = shapes.reduce((a, s) => a + s.m.edgeBound, 0) / shapes.length;
  if (meanEdge > 0.6)
    fail(
      `mean edgeBound ${meanEdge.toFixed(2)} — the outer ring is no longer held by a ` +
        `few regions, so these are not frame boards (organic sits at 0.86-0.90)`
    );
  else console.log(`ok    mean edgeBound ${meanEdge.toFixed(2)} (organic: 0.86-0.90)`);

  // And at least some of them really do carry the screenshot's signature.
  const hits = shapes.filter((s) => frameLike(s.m)).length;
  if (!hits) fail('not one board matched the frame signature across the whole sample');
  else console.log(`ok    ${hits}/${shapes.length} boards match the frame signature`);
}

// The size rule, as the two call sites state it. Read out of the sources rather
// than restated here: the point is that live generation and the pool builder
// agree, and a test carrying its own copy of the numbers could not see them
// drift apart.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const num = (src, name) => {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(src);
  return m ? Number(m[1]) : null;
};
const main = readFileSync(join(ROOT, 'js', 'main.js'), 'utf8');
const levels = readFileSync(join(ROOT, 'tools', 'generate-levels.mjs'), 'utf8');
const pairs = [
  ['FRAME_MAX_SIZE', 'FRAME_MAX_FROM'],
  ['FRAME_MAX_EASY_SIZE', 'FRAME_MAX_EASY_FROM'],
];
for (const [a, b] of pairs) {
  const va = num(main, a);
  const vb = num(levels, b);
  if (va === null) fail(`js/main.js no longer defines ${a}`);
  else if (vb === null) fail(`tools/generate-levels.mjs no longer defines ${b}`);
  else if (va !== vb) fail(`${a} (${va}) and ${b} (${vb}) disagree — the pools and live generation would disagree`);
  else console.log(`ok    ${a} === ${b} === ${va}`);
}
// Easy gives out a size earlier than the rest, never later.
const maxSize = num(main, 'FRAME_MAX_SIZE');
const maxEasy = num(main, 'FRAME_MAX_EASY_SIZE');
if (maxSize !== null && maxEasy !== null && maxEasy > maxSize)
  fail(`FRAME_MAX_EASY_SIZE (${maxEasy}) above FRAME_MAX_SIZE (${maxSize})`);

console.log(
  `\nframe-style: ${checked} boards checked, ${failures} failure${failures === 1 ? '' : 's'}`
);
process.exit(failures ? 1 : 0);
