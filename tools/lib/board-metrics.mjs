// board-metrics.mjs — the yardstick for "what does a Queens board LOOK like".
//
// Every region-growth style in js/generator.js produces boards that are equally
// valid (unique solution, logic-solvable) and differ only in geometry. Arguing
// about that geometry from screenshots does not scale: this module turns a board
// into numbers, so a new style can be compared against the existing ones and
// against the reference screenshots with a table instead of an opinion.
//
// Three groups, deliberately separate because they answer different questions:
//
//   SHAPE  — what the colouring looks like.      boardShape(N, region)
//   PLAY   — which deductions it runs on.        playProfile(N, region, solution)
//   COST   — what it takes to produce.           measured by the sampler, not here.
//
// The eight SHAPE numbers are the ones that actually separate the styles we
// have; see docs/board-styles.md for what each is for, which styles sit where,
// and the thresholds. Pure Node, no deps.

const ORTHO = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

// ---------------------------------------------------------------- shape

// Corners of one region's outline, via the classic vertex rule: at each lattice
// vertex look at the four surrounding cells; 1 or 3 of them inside the region is
// one corner, a diagonal pair is two. A rectangle scores 4, so this reads
// directly as "how rectangle-like is this colour".
export function corners(N, region, reg) {
  const inR = (r, c) => r >= 0 && r < N && c >= 0 && c < N && region[r][c] === reg;
  let total = 0;
  for (let vr = 0; vr <= N; vr++)
    for (let vc = 0; vc <= N; vc++) {
      const q = [inR(vr - 1, vc - 1), inR(vr - 1, vc), inR(vr, vc - 1), inR(vr, vc)];
      const n = q.filter(Boolean).length;
      if (n === 1 || n === 3) total += 1;
      else if (n === 2 && ((q[0] && q[3]) || (q[1] && q[2]))) total += 2;
    }
  return total;
}

// Mean length of a maximal straight run in the INTERNAL border network — the
// most direct reading of "were these borders drawn with a ruler". The board
// outline is excluded on purpose: it is the same four straight lines for every
// style, so including it would flatter every board equally and discriminate
// nothing.
export function borderStraightness(N, region) {
  const runs = [];
  // Vertical border edges: between (r,c) and (r,c+1). A run is consecutive rows
  // sharing the same column boundary.
  for (let c = 0; c + 1 < N; c++) {
    let len = 0;
    for (let r = 0; r < N; r++) {
      if (region[r][c] !== region[r][c + 1]) len++;
      else if (len) {
        runs.push(len);
        len = 0;
      }
    }
    if (len) runs.push(len);
  }
  // Horizontal border edges: between (r,c) and (r+1,c).
  for (let r = 0; r + 1 < N; r++) {
    let len = 0;
    for (let c = 0; c < N; c++) {
      if (region[r][c] !== region[r + 1][c]) len++;
      else if (len) {
        runs.push(len);
        len = 0;
      }
    }
    if (len) runs.push(len);
  }
  if (!runs.length) return 0;
  return runs.reduce((a, b) => a + b, 0) / runs.length;
}

// Gini coefficient of the region sizes: 0 = every colour the same area, higher =
// a few big colours and a tail of small ones. This is the axis the older metrics
// were blind to — `maxShare` only sees the single biggest region, so a board
// with THREE large colours and four tiny ones reads as "no background" there
// while being just as hierarchical as one with a single dominant colour.
export function gini(values) {
  const v = values.slice().sort((a, b) => a - b);
  const n = v.length;
  const sum = v.reduce((a, b) => a + b, 0);
  if (!sum) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (2 * (i + 1) - n - 1) * v[i];
  return acc / (n * sum);
}

// Per-region boxes, areas, strip flag and neighbour set in one pass.
function regionFacts(N, region) {
  const box = Array.from({ length: N }, () => ({ r0: N, r1: -1, c0: N, c1: -1, area: 0 }));
  const neighbours = Array.from({ length: N }, () => new Set());
  const onEdge = new Array(N).fill(false);
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const g = region[r][c];
      const b = box[g];
      b.area++;
      if (r < b.r0) b.r0 = r;
      if (r > b.r1) b.r1 = r;
      if (c < b.c0) b.c0 = c;
      if (c > b.c1) b.c1 = c;
      if (r === 0 || c === 0 || r === N - 1 || c === N - 1) onEdge[g] = true;
      for (const [dr, dc] of ORTHO) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        if (region[nr][nc] !== g) neighbours[g].add(region[nr][nc]);
      }
    }
  return { box, neighbours, onEdge };
}

/**
 * The eight SHAPE numbers for one board.
 * @returns {{sizes:number[], sizeMin:number, maxShare:number, gini:number,
 *   ones:number, corners:number, bboxFill:number, straight:number,
 *   stripShare:number, degree:number, edgeBound:number, flatRegions:number}}
 */
export function boardShape(N, region) {
  const { box, neighbours, onEdge } = regionFacts(N, region);
  const sizes = box.map((b) => b.area);
  let cornerSum = 0;
  let fillSum = 0;
  let strips = 0;
  let flat = 0;
  let degreeSum = 0;
  let edge = 0;
  for (let g = 0; g < N; g++) {
    const b = box[g];
    if (b.area === 0) continue;
    const h = b.r1 - b.r0 + 1;
    const w = b.c1 - b.c0 + 1;
    cornerSum += corners(N, region, g);
    fillSum += b.area / (h * w);
    // Strict strip: one cell wide AND solid along that line, so an L-bend does
    // not count. Area >= 2, because a lone cell is a freebie queen and is
    // counted by `ones` — calling it a strip too would double-count it and let a
    // board of single cells score as a perfect strips board.
    if (b.area >= 2 && (h === 1 || w === 1) && b.area === Math.max(h, w)) strips++;
    if (h === 1 || w === 1) flat++;
    degreeSum += neighbours[g].size;
    if (onEdge[g]) edge++;
  }
  return {
    sizes: sizes.slice().sort((a, b) => a - b),
    sizeMin: Math.min(...sizes),
    maxShare: Math.max(...sizes) / (N * N),
    gini: gini(sizes),
    ones: sizes.filter((s) => s === 1).length,
    corners: cornerSum / N,
    bboxFill: fillSum / N,
    straight: borderStraightness(N, region),
    stripShare: strips / N,
    degree: degreeSum / N,
    edgeBound: edge / N,
    flatRegions: flat, // legacy field, kept so tools/compare-styles.mjs still reads
  };
}

// ------------------------------------------------------------- signature

// The eight numbers that form a style's fingerprint, and the SCALE each one is
// divided by before styles are compared. The scale is a FIXED, hand-set "how
// much of this metric is a visible difference" — not a standard deviation
// computed from the sample, because that would move every time a style is added
// and make yesterday's distances incomparable with today's. See
// docs/board-styles.md for where each number comes from.
export const SIGNATURE_KEYS = [
  'corners',
  'bboxFill',
  'straight',
  'maxShare',
  'gini',
  'ones',
  'stripShare',
  'degree',
  'edgeBound',
];

export const SIGNATURE_SCALE = {
  corners: 4, // one extra bend per region
  bboxFill: 0.2, // a fifth of the bounding box
  straight: 0.5, // half a cell of border run
  maxShare: 0.1, // ten points of board share
  gini: 0.1, // ten points of size inequality
  ones: 1, // one freebie region per board
  stripShare: 0.15, // ~one region in seven turning into a strip
  degree: 1, // one more neighbouring colour per region
  edgeBound: 0.15, // ~one region in seven losing its foothold on the border
};

/**
 * Distance between two shape fingerprints: the mean absolute difference across
 * SIGNATURE_KEYS, each in units of its own scale. 0 = identical.
 *
 * Read it as: "on average, each metric differs by this many just-noticeable
 * steps". docs/board-styles.md pins the bands (same look / variant / different
 * construction) and why they sit where they do.
 */
export function signatureDistance(a, b) {
  let sum = 0;
  for (const k of SIGNATURE_KEYS) sum += Math.abs(a[k] - b[k]) / SIGNATURE_SCALE[k];
  return sum / SIGNATURE_KEYS.length;
}

/** Mean of a list of shape objects — the fingerprint of a whole style. */
export function meanShape(shapes) {
  const out = {};
  const keys = ['maxShare', 'gini', 'ones', 'corners', 'bboxFill', 'straight', 'stripShare', 'degree', 'edgeBound', 'sizeMin'];
  for (const k of keys) out[k] = shapes.reduce((a, s) => a + s[k], 0) / shapes.length;
  out.n = shapes.length;
  return out;
}

const LETTERS = 'ABCDEFGHIJKLMN';
export function ascii(N, region) {
  return Array.from({ length: N }, (_, r) =>
    Array.from({ length: N }, (_, c) => LETTERS[region[r][c]]).join(' ')
  ).join('\n');
}
