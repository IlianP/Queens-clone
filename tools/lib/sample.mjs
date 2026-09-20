// Shared sampling helpers for the style lab: generate boards of one style,
// measure them, and record what it cost. Kept out of tools/style-lab.mjs so the
// regression test can sample without importing a CLI.
import { generatePuzzle } from '../../js/generator.js';
import { computeHint } from '../../js/hint.js';
import { difficultyLevel, nakedSingleReach } from '../../js/solver.js';
import { boardShape, meanShape } from './board-metrics.mjs';

const LEVEL_OF = { easy: 0, medium: 1, hard: 2 };

/**
 * Drive a board to completion with hints alone and tally which technique each
 * step used. This is the PLAY half of the yardstick: two styles can look
 * different and still play identically, or look similar and run on completely
 * different deductions — the shape numbers cannot see that.
 */
export function playProfile(N, region, solution) {
  const queen = Array.from({ length: N }, () => Array(N).fill(false));
  const mark = Array.from({ length: N }, () => Array(N).fill(false));
  const tally = {};
  let placed = 0;
  let steps = 0;
  for (; steps < N * N * 4 && placed < N; steps++) {
    const queens = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (queen[r][c]) queens.push([r, c]);
    const hint = computeHint(N, region, solution, queens, mark);
    tally[hint.technique] = (tally[hint.technique] || 0) + 1;
    if (hint.kind === 'place') {
      const [r, c] = hint.targetCells[0];
      queen[r][c] = true;
      placed++;
    } else if (hint.kind === 'eliminate') {
      let progressed = false;
      for (const [r, c] of hint.targetCells)
        if (!mark[r][c] && !queen[r][c]) {
          mark[r][c] = true;
          progressed = true;
        }
      if (!progressed) return { steps, tally, ok: false };
    } else return { steps, tally, ok: false };
  }
  return { steps, tally, ok: placed === N };
}

/**
 * Sample one (style, N, difficulty) cell.
 * @returns {{shape:object, level:number, reach:number, msPerBoard:number,
 *   yield:number, steps:number, tech:object, shapes:object[], boards:object[]}}
 */
export function sampleStyle(N, difficulty, style, { ms = 6000, rng, play = true } = {}) {
  const want = LEVEL_OF[difficulty];
  const shapes = [];
  const boards = [];
  let reach = 0;
  let steps = 0;
  const tech = {};
  let techTotal = 0;
  let tries = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    tries++;
    const p = generatePuzzle(N, difficulty, { style, budgetMs: 1500, rng });
    if (p.level !== want) continue;
    shapes.push(boardShape(N, p.region));
    boards.push(p);
    reach += nakedSingleReach(N, p.region);
    if (play) {
      const pr = playProfile(N, p.region, p.solution);
      steps += pr.steps;
      for (const [k, v] of Object.entries(pr.tally)) {
        tech[k] = (tech[k] || 0) + v;
        techTotal += v;
      }
    }
  }
  const elapsed = Date.now() - t0;
  const n = shapes.length;
  if (!n) return { n: 0, msPerBoard: Infinity, yield: 0, shape: null, tech: {}, boards: [] };
  for (const k of Object.keys(tech)) tech[k] /= techTotal;
  return {
    n,
    shape: meanShape(shapes),
    shapes,
    boards,
    level: want,
    reach: reach / n,
    steps: steps / n,
    tech,
    msPerBoard: elapsed / n,
    yield: n / tries,
  };
}

export { LEVEL_OF };
