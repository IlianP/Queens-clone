// The yardstick itself, under test. Run with plain Node:
//
//   node tests/logic/style-metrics.mjs
//
// docs/board-styles.md defines a metric suite and pins where every region-growth
// style sits in it. A document cannot notice when a grower drifts, so this
// checks the three claims that document rests on:
//
//   1. The metrics do what they say. Hand-built boards with a KNOWN shape (a
//      perfect rectangular partition, a strip board, a one-background board)
//      must score what the definitions promise — otherwise the whole table is
//      measuring something else and every conclusion drawn from it is void.
//   2. The four reference screenshots still parse as valid puzzles, each still
//      matches exactly the signature the doc credits it with, and is still
//      rated what the doc says.
//   3. Each shipped style still lands in its documented band. These are RANGES,
//      not fixed numbers: generation is random, so a tight assertion would flap.
//      They are wide enough to survive noise and narrow enough that swapping two
//      styles' growers, or routing one through the wrong repair, fails here.
//
// It deliberately does NOT pin the experimental styles' numbers. They exist to
// be re-measured, not preserved — see the doc's "Kandidaten" section.
import { generatePuzzle } from '../../js/generator.js';
import { countSolutions, difficultyLevel } from '../../js/solver.js';
import { boardShape, signatureDistance, gini, borderStraightness } from '../../tools/lib/board-metrics.mjs';
import { REFERENCE, shotLike, stripLike, frameLike } from '../../tools/lib/references.mjs';
import { contiguous, solveByHints } from './lib/board-checks.mjs';

let failures = 0;
const fail = (msg) => {
  console.error(`FAIL  ${msg}`);
  failures++;
};
const ok = (msg) => console.log(`ok    ${msg}`);
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));
const between = (v, lo, hi, msg) =>
  check(v >= lo && v <= hi, `${msg}: ${v.toFixed(2)} in [${lo}, ${hi}]`);

// ---------------------------------------------------------------------------
// 1. The metrics measure what their definitions claim.
// ---------------------------------------------------------------------------

// A 4x4 cut into four 2x2 blocks: every region a perfect square.
const BLOCKS = [
  [0, 0, 1, 1],
  [0, 0, 1, 1],
  [2, 2, 3, 3],
  [2, 2, 3, 3],
];
{
  const m = boardShape(4, BLOCKS);
  check(m.corners === 4, `rectangles score exactly 4 corners (got ${m.corners})`);
  check(m.bboxFill === 1, `rectangles fill their bounding box (got ${m.bboxFill})`);
  check(m.gini === 0, `equal areas give Gini 0 (got ${m.gini})`);
  check(m.maxShare === 0.25, `four equal quarters give maxShare 0.25 (got ${m.maxShare})`);
  check(m.stripShare === 0, '2x2 blocks are not strips');
  check(m.edgeBound === 1, 'every quarter touches the outer ring');
  // Two full-length internal borders, one vertical and one horizontal.
  check(m.straight === 4, `a clean cross scores 4-cell border runs (got ${m.straight})`);
  check(m.degree === 2, `each quarter touches two others (got ${m.degree})`);
}

// Four full-width bands: strips by the strict definition, and maximally
// straight borders.
const BANDS = [
  [0, 0, 0, 0],
  [1, 1, 1, 1],
  [2, 2, 2, 2],
  [3, 3, 3, 3],
];
{
  const m = boardShape(4, BANDS);
  check(m.stripShare === 1, 'full-width bands are all strips');
  check(m.straight === 4, 'band borders run the full width');
  check(m.edgeBound === 1, 'every band reaches both side edges');
}

// One background plus three single cells: the freebie/dominance extreme.
const LOPSIDED = [
  [1, 2, 0, 0],
  [3, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];
{
  const m = boardShape(4, LOPSIDED);
  check(m.ones === 3, `three single-cell regions counted (got ${m.ones})`);
  check(m.maxShare === 13 / 16, `background share is 13/16 (got ${m.maxShare})`);
  check(m.stripShare === 0, 'a lone cell is a freebie, not a strip');
  check(m.sizeMin === 1, 'smallest region is one cell');
  // Gini tops out at (n-1)/n = 0.75 for four regions, so 0.56 IS the lopsided
  // end of the scale here — the bound is set against that ceiling, not against 1.
  check(m.gini > 0.5, `a background plus freebies is highly unequal (got ${m.gini.toFixed(2)})`);
}

check(gini([5, 5, 5, 5]) === 0, 'Gini of equal values is 0');
check(gini([0, 0, 0, 12]) > 0.7, 'Gini of a single winner is near 1');
check(borderStraightness(2, [[0, 0], [0, 0]]) === 0, 'a single region has no internal border');

// A fingerprint is zero distance from itself, and distance is symmetric.
{
  const a = boardShape(4, BLOCKS);
  const b = boardShape(4, BANDS);
  check(signatureDistance(a, a) === 0, 'signature distance to self is 0');
  check(
    Math.abs(signatureDistance(a, b) - signatureDistance(b, a)) < 1e-12,
    'signature distance is symmetric'
  );
  // Known and accepted limit of the suite: it measures the STATISTICS of the
  // regions, not how they are arranged. Four 2x2 blocks and four full-width
  // bands are both tidy equal-area rectangles, so they come out a "variant"
  // apart (~0.8) rather than a different construction, separated only by
  // stripShare. A layout metric would be needed to say more, and none of the
  // styles we have needs one — see docs/board-styles.md, "Was die Suite nicht
  // misst".
  const d = signatureDistance(a, b);
  check(d > 0.5 && d < 1.2, `blocks and bands read as a variant apart (${d.toFixed(2)})`);
}

// ---------------------------------------------------------------------------
// 2. The reference screenshots.
// ---------------------------------------------------------------------------
const SIGNATURE_OF = {
  blocky: (m, N) => shotLike(m),
  strips: (m, N) => stripLike(m, N),
  frame: (m) => frameLike(m),
};
const LEVEL_NAME = ['easy', 'medium', 'hard', '>hard'];

for (const ref of REFERENCE) {
  const { N, region, solution, name } = ref;
  check(countSolutions(N, region, 200000) === 1, `${name}: exactly one solution`);
  for (let g = 0; g < N; g++) check(contiguous(N, region, g), `${name}: region ${g} is contiguous`);
  for (let r = 0; r < N; r++)
    if (region[r][solution[r]] === undefined) fail(`${name}: solution leaves the board in row ${r}`);
  check(
    LEVEL_NAME[difficultyLevel(N, region)] === ref.rating,
    `${name}: rated ${ref.rating} (got ${LEVEL_NAME[difficultyLevel(N, region)]})`
  );
  const solved = solveByHints(N, region, solution);
  check(solved.ok, `${name}: solvable by hints alone${solved.ok ? '' : ` — ${solved.reason}`}`);
  const m = boardShape(N, region);
  check(SIGNATURE_OF[ref.matches](m, N), `${name}: matches the '${ref.matches}' signature`);
}

// Screenshot D is the reason `frameLike` exists, so make the separation
// explicit rather than trusting the table: it is the ONLY reference that has it.
{
  const hits = REFERENCE.filter((r) => frameLike(boardShape(r.N, r.region))).map((r) => r.name);
  check(
    hits.length === 1 && hits[0] === 'Screenshot D',
    `only Screenshot D matches the frame signature (got ${hits.join(', ') || 'none'})`
  );
}

// ---------------------------------------------------------------------------
// 3. The shipped styles still sit where the doc says.
// ---------------------------------------------------------------------------
// [metric, lo, hi] per style, measured at 8x8 hard over thousands of boards and
// widened generously. See docs/board-styles.md for the measured means.
const BANDS_BY_STYLE = {
  organic: { maxShare: [0.15, 0.32], stripShare: [0.0, 0.2], edgeBound: [0.75, 1.0], bboxFill: [0.58, 0.8] },
  blocky: { maxShare: [0.26, 0.5], stripShare: [0.1, 0.45], edgeBound: [0.7, 1.0], bboxFill: [0.65, 0.88] },
  strips: { maxShare: [0.5, 0.82], stripShare: [0.75, 1.0], edgeBound: [0.4, 0.85], bboxFill: [0.86, 1.0] },
};
const SAMPLE = 14;

for (const [style, bands] of Object.entries(BANDS_BY_STYLE)) {
  const shapes = [];
  for (let i = 0; i < SAMPLE; i++) {
    const p = generatePuzzle(8, 'hard', { style, budgetMs: 2500 });
    if (p.level !== 2) continue;
    shapes.push(boardShape(8, p.region));
    // Every style, experimental or not, owes the same invariants.
    for (let g = 0; g < 8; g++)
      if (!contiguous(8, p.region, g)) fail(`${style}: region ${g} not contiguous`);
  }
  if (shapes.length < SAMPLE / 2) {
    fail(`${style}: only ${shapes.length}/${SAMPLE} boards came back at the target level`);
    continue;
  }
  const mean = (k) => shapes.reduce((a, s) => a + s[k], 0) / shapes.length;
  for (const [k, [lo, hi]] of Object.entries(bands)) between(mean(k), lo, hi, `${style} ${k}`);
}

// The separations the doc's whole argument rests on: strips must stay far from
// the other two, and the two "looks like a screenshot" styles must keep beating
// organic at their own signature.
{
  const meanOf = (style) => {
    const shapes = [];
    for (let i = 0; i < SAMPLE; i++) {
      const p = generatePuzzle(8, 'hard', { style, budgetMs: 2500 });
      if (p.level === 2) shapes.push(boardShape(8, p.region));
    }
    const out = {};
    for (const k of Object.keys(shapes[0])) {
      if (typeof shapes[0][k] !== 'number') continue;
      out[k] = shapes.reduce((a, s) => a + s[k], 0) / shapes.length;
    }
    return out;
  };
  const org = meanOf('organic');
  const blk = meanOf('blocky');
  const str = meanOf('strips');
  check(
    signatureDistance(str, org) > 1 && signatureDistance(str, blk) > 1,
    `strips is a different construction from both (organic ${signatureDistance(str, org).toFixed(2)}, blocky ${signatureDistance(str, blk).toFixed(2)})`
  );
  check(
    signatureDistance(org, blk) < 1,
    `organic and blocky remain variants of one look (${signatureDistance(org, blk).toFixed(2)})`
  );
}

console.log(`\n${failures ? `${failures} failed` : 'all style-metric checks passed'}`);
process.exit(failures ? 1 : 0);
