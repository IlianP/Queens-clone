// Shared checks for the region-growth style tests (../blocky-style.mjs,
// ../strips-style.mjs). Pure Node, no deps — importing this runs nothing.
//
// It lives in lib/ rather than next to them because CI runs every
// tests/logic/*.mjs as a self-contained runner; a library in that glob would be
// "run" as a test that asserts nothing.
//
// hint-solve.mjs deliberately keeps its own copy of the drive loop: it is the
// CI smoke test for the whole logic spine and its loop is written to read as
// "this is exactly what a player does", including the reporting. The two style
// tests want the stricter variant below (it also fails when an eliminate hint
// would mark a solution cell), and there is no reason for two copies of that.
import { computeHint } from '../../../js/hint.js';

const ORTHO = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

// Is colour region `g` one orthogonally-connected blob?
export function contiguous(N, region, g) {
  let start = -1;
  let total = 0;
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (region[r][c] === g) {
        total++;
        if (start < 0) start = r * N + c;
      }
  if (start < 0) return false;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const idx = stack.pop();
    const r = (idx / N) | 0;
    const c = idx % N;
    for (const [dr, dc] of ORTHO) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
      if (region[nr][nc] !== g) continue;
      const ni = nr * N + nc;
      if (seen.has(ni)) continue;
      seen.add(ni);
      stack.push(ni);
    }
  }
  return seen.size === total;
}

// Per-region geometry: area, and whether the region is a STRIP — one cell wide
// in one dimension and filling that line solidly. `sizes[g]` is region g's area.
export function regionShapes(N, region) {
  const box = Array.from({ length: N }, () => ({ r0: N, r1: -1, c0: N, c1: -1, area: 0 }));
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const b = box[region[r][c]];
      b.area++;
      if (r < b.r0) b.r0 = r;
      if (r > b.r1) b.r1 = r;
      if (c < b.c0) b.c0 = c;
      if (c > b.c1) b.c1 = c;
    }
  const sizes = box.map((b) => b.area);
  const strips = box.map((b) => {
    if (b.area === 0) return false;
    const h = b.r1 - b.r0 + 1;
    const w = b.c1 - b.c0 + 1;
    return (h === 1 || w === 1) && b.area === Math.max(h, w);
  });
  return { sizes, strips, stripCount: strips.filter(Boolean).length };
}

// Drive one puzzle to completion using only hints, exactly as main.js feeds the
// engine: computeHint(N, region, solution, queens, manualMarks). A 'place' hint
// sets a queen, an 'eliminate' hint sets manual marks. A correct engine never
// suggests a move that contradicts the known solution, so any such suggestion
// fails the test rather than being applied.
export function solveByHints(N, region, solution) {
  const queen = Array.from({ length: N }, () => Array(N).fill(false));
  const mark = Array.from({ length: N }, () => Array(N).fill(false));
  const collectQueens = () => {
    const out = [];
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) if (queen[r][c]) out.push([r, c]);
    return out;
  };

  for (let step = 0; step < N * N * 4; step++) {
    const queens = collectQueens();
    if (queens.length === N) {
      for (let r = 0; r < N; r++)
        if (!queen[r][solution[r]]) return { ok: false, reason: `row ${r} queen off-solution` };
      return { ok: true };
    }
    const hint = computeHint(N, region, solution, queens, mark);
    if (hint.kind === 'place') {
      const [r, c] = hint.targetCells[0];
      if (solution[r] !== c)
        return { ok: false, reason: `hint placed a queen off-solution at ${r},${c}` };
      queen[r][c] = true;
      mark[r][c] = false;
    } else if (hint.kind === 'eliminate') {
      let progressed = false;
      for (const [r, c] of hint.targetCells) {
        if (solution[r] === c)
          return { ok: false, reason: `hint eliminated the solution cell ${r},${c}` };
        if (!mark[r][c] && !queen[r][c]) {
          mark[r][c] = true;
          progressed = true;
        }
      }
      if (!progressed) return { ok: false, reason: 'eliminate hint marked nothing new (stalled)' };
    } else if (hint.kind === 'mistake') {
      return { ok: false, reason: `mistake reported on a clean board: ${hint.title}` };
    } else {
      return { ok: false, reason: `no hint with ${queens.length}/${N} queens placed` };
    }
  }
  return { ok: false, reason: 'no progress within the step budget' };
}
