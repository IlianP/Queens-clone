// Measure the *shape* of Queens boards, so "these levels look different" can be
// argued with numbers instead of vibes.
//
//   node tools/compare-styles.mjs                 # pools vs. both styles
//   node tools/compare-styles.mjs --size 8        # one size only
//   node tools/compare-styles.mjs --ms 20000      # longer sampling per cell
//   node tools/compare-styles.mjs --show 8 hard   # print example boards
//
// Background: screenshots from another Queens app showed level styles our own
// generator did not produce. A and B have visibly straighter borders, one big
// "background" colour and a few tiny compact ones — that pair is what the
// 'blocky' style was built from. C is a further step: SEVEN of its eight colours
// are straight one-cell-wide segments around a single 64% background, which is
// what the 'strips' style was built from. Transcribed and fed through our own
// solver, all three rate level 2 (hard) with a naked-single reach of 0 — so the
// difference is geometry, not difficulty. The metrics below are the ones that
// actually separate the styles; REFERENCE holds the transcribed screenshots so
// the comparison has a fixed target.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { generatePuzzle } from '../js/generator.js';
import { decodePuzzle } from '../js/levels.js';
import { difficultyLevel, nakedSingleReach } from '../js/solver.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The two screenshots, transcribed cell by cell (region ids are arbitrary labels).
export const REFERENCE = [
  {
    name: 'Screenshot A',
    N: 8,
    region: [
      [0, 0, 2, 3, 3, 3, 3, 3],
      [0, 1, 2, 2, 4, 3, 3, 3],
      [0, 1, 4, 4, 4, 3, 3, 3],
      [0, 0, 4, 4, 4, 4, 3, 5],
      [4, 4, 4, 4, 4, 4, 5, 5],
      [4, 6, 6, 6, 4, 5, 5, 5],
      [4, 4, 4, 4, 4, 5, 7, 5],
      [4, 4, 4, 7, 7, 7, 7, 5],
    ],
    solution: [0, 3, 1, 6, 4, 2, 7, 5],
  },
  {
    name: 'Screenshot B',
    N: 7,
    region: [
      [0, 0, 0, 0, 0, 1, 2],
      [0, 0, 0, 0, 0, 1, 2],
      [0, 3, 3, 3, 3, 1, 1],
      [0, 3, 4, 4, 4, 1, 1],
      [0, 3, 4, 4, 4, 4, 4],
      [0, 5, 6, 6, 4, 4, 4],
      [5, 5, 4, 4, 4, 4, 4],
    ],
    solution: [6, 3, 5, 1, 4, 2, 0],
  },
  {
    // Region 0 is the background (41 of 64 cells). Every other colour is a
    // straight segment: 1 is a 1x5 column, 2/3 are 1x2 rows, 4/5 are 1x3
    // columns, 6/7 are 1x4 rows.
    name: 'Screenshot C',
    N: 8,
    region: [
      [1, 2, 2, 0, 0, 0, 0, 0],
      [1, 0, 3, 3, 0, 0, 0, 4],
      [1, 0, 0, 0, 0, 0, 5, 4],
      [1, 0, 0, 0, 0, 0, 5, 4],
      [1, 0, 0, 0, 0, 0, 5, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 6, 6, 6, 6, 0, 0],
      [0, 0, 0, 7, 7, 7, 7, 0],
    ],
    solution: [1, 3, 7, 0, 6, 4, 2, 5],
  },
];

// ---------- shape metrics ----------

// Corners of a region's outline, via the classic vertex rule: at each lattice
// vertex look at the four surrounding cells; 1 or 3 of them inside the region is
// one corner, a diagonal pair is two. A rectangle scores 4, so this is a direct
// "how rectangle-like is this colour" number.
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

export function boardMetrics(N, region) {
  const sizes = [];
  const corn = [];
  let flat = 0; // regions only one row tall or one column wide (strips)
  for (let reg = 0; reg < N; reg++) {
    let r0 = N;
    let r1 = -1;
    let c0 = N;
    let c1 = -1;
    let area = 0;
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        if (region[r][c] === reg) {
          area++;
          r0 = Math.min(r0, r);
          r1 = Math.max(r1, r);
          c0 = Math.min(c0, c);
          c1 = Math.max(c1, c);
        }
    sizes.push(area);
    corn.push(corners(N, region, reg));
    if (r1 - r0 === 0 || c1 - c0 === 0) flat++;
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    sizes: sizes.slice().sort((a, b) => a - b),
    sizeMin: Math.min(...sizes),
    sizeMaxShare: Math.max(...sizes) / (N * N),
    ones: sizes.filter((s) => s === 1).length,
    corners: avg(corn),
    flatRegions: flat,
  };
}

// The signature screenshots A and B share, and the thing 'blocky' is measured
// by: no free single-cell colour, but small ones exist; one dominant background
// colour; at least two strip-shaped regions.
export const shotLike = (m) =>
  m.ones === 0 && m.sizeMin <= 3 && m.sizeMaxShare >= 0.3 && m.flatRegions >= 2;

// Screenshot C's much stricter signature, and what 'strips' is measured by:
// every colour but one is a strip, and the one that isn't dominates the board.
// Scanned over the 1760 boards the pools held before the strips style existed,
// this was true of 0.15% of blocky boards and of no organic board at all — which
// is why it needed a grower of its own rather than a tweak to the other two.
export const stripLike = (m, N) => m.ones === 0 && m.flatRegions >= N - 1 && m.sizeMaxShare >= 0.5;

const STYLES = ['organic', 'blocky', 'strips'];

const LETTERS = 'ABCDEFGHIJKLMN';
export function ascii(N, region) {
  return Array.from({ length: N }, (_, r) =>
    Array.from({ length: N }, (_, c) => LETTERS[region[r][c]]).join(' ')
  ).join('\n');
}

// ---------- CLI ----------
// Everything above is importable (REFERENCE and the metrics are useful on their
// own); the CLI below only runs when this file is the entry point, so an
// `import` of it doesn't kick off a multi-minute measurement run.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) runCli();

function runCli() {
  const args = process.argv.slice(2);
  const argValue = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const onlySize = argValue('--size') ? Number(argValue('--size')) : null;
  const sampleMs = argValue('--ms') ? Number(argValue('--ms')) : 8000;
  const showIdx = args.indexOf('--show');

  const fmtRow = (label, m, extra = '') =>
    `${label.padEnd(26)} | ${m.corners.toFixed(1).padStart(5)} | ` +
    `${(m.sizeMaxShare * 100).toFixed(0).padStart(7)}% | ${m.ones.toFixed(2).padStart(4)} | ` +
    `${m.flatRegions.toFixed(1).padStart(4)} |${extra}`;
  const HEAD =
    'Quelle                     | Ecken | maxShare |  1er | flat |  reach | A/B-like | C-like';

  if (showIdx >= 0) {
    const N = Number(args[showIdx + 1] || 8);
    const difficulty = args[showIdx + 2] || 'hard';
    for (const style of STYLES) {
      for (let i = 0; i < 2; i++) {
        const p = generatePuzzle(N, difficulty, { style, budgetMs: 3000 });
        const m = boardMetrics(N, p.region);
        console.log(
          `\n--- ${style} ${N}x${N} ${difficulty} (rating ${p.level}) | Ecken Ø${m.corners.toFixed(1)}` +
            ` | maxShare ${(m.sizeMaxShare * 100).toFixed(0)}% | Größen [${m.sizes.join(',')}]`
        );
        console.log(ascii(N, p.region));
      }
    }
    process.exit(0);
  }

  console.log('=== Referenz: die beiden Screenshots ===');
  console.log(HEAD);
  for (const ref of REFERENCE) {
    const m = boardMetrics(ref.N, ref.region);
    const lvl = difficultyLevel(ref.N, ref.region);
    const reach = nakedSingleReach(ref.N, ref.region);
    console.log(
      fmtRow(
        `${ref.name} (${ref.N}x${ref.N})`,
        m,
        ` ${String(reach).padStart(6)} | ${(shotLike(m) ? 'ja' : 'nein').padStart(8)} | ${stripLike(m, ref.N) ? 'ja' : 'nein'}`
      ) + `   [Rating ${lvl} = ${['easy', 'medium', 'hard', '>hard'][lvl]}, Größen ${m.sizes.join(',')}]`
    );
  }

  const SIZES = onlySize !== null ? [onlySize] : [6, 7, 8, 9, 10];
  console.log('\n=== ausgelieferte Pools (levels/) vs. live erzeugte Stile ===');
  console.log(HEAD);
  for (const N of SIZES) {
    for (const difficulty of ['easy', 'medium', 'hard']) {
      if (N >= 12 && difficulty !== 'hard') continue;
      const rows = [];

      let pool = null;
      try {
        pool = JSON.parse(readFileSync(join(ROOT, 'levels', `${N}-${difficulty}.json`), 'utf8'));
      } catch {
        /* bucket may not exist */
      }
      if (pool) rows.push(['Pool', pool.puzzles.map((e) => decodePuzzle(N, e).region)]);

      for (const style of STYLES) {
        const boards = [];
        const t0 = Date.now();
        while (Date.now() - t0 < sampleMs) {
          const p = generatePuzzle(N, difficulty, { style, budgetMs: 1500 });
          if (p.level === (difficulty === 'easy' ? 0 : difficulty === 'medium' ? 1 : 2))
            boards.push(p.region);
        }
        rows.push([`live ${style}`, boards]);
      }

      for (const [label, boards] of rows) {
        if (!boards.length) {
          console.log(`${`${N}-${difficulty} ${label}`.padEnd(26)} | (keine Bretter)`);
          continue;
        }
        const acc = { corners: 0, sizeMaxShare: 0, ones: 0, flatRegions: 0 };
        let reach = 0;
        let shot = 0;
        let strip = 0;
        for (const region of boards) {
          const m = boardMetrics(N, region);
          for (const k of Object.keys(acc)) acc[k] += m[k];
          reach += nakedSingleReach(N, region);
          if (shotLike(m)) shot++;
          if (stripLike(m, N)) strip++;
        }
        const k = boards.length;
        for (const key of Object.keys(acc)) acc[key] /= k;
        console.log(
          fmtRow(
            `${N}-${difficulty} ${label}`,
            acc,
            ` ${(reach / k).toFixed(1).padStart(6)} | ${`${Math.round((100 * shot) / k)}%`.padStart(8)} | ` +
              `${`${Math.round((100 * strip) / k)}%`.padStart(4)} (n=${k})`
          )
        );
      }
      console.log('');
    }
  }
}
