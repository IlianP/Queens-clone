// Behavioural check for the precomputed pools in levels/ — run after
// tools/generate-levels.mjs and after ANY change to generator/solver/hint
// logic (stale pools would carry outdated difficulty ratings). Exits non-zero
// on the first structural problem or any failed assertion.
//
//   node tools/verify-levels.mjs
//
// Per stored puzzle: decodes cleanly, region ids are exactly 0..N-1 and every
// region is contiguous, the solution is valid, the solution is UNIQUE, the
// difficulty rating matches the bucket, the puzzle is solvable by the
// explainable techniques, and no two pool entries are D4 copies of each other.
// Per transform: validity, uniqueness and rating survive all 8 symmetries.
// Per bucket: one random (puzzle, transform) is solved end-to-end purely by
// applying computeHint — the smoke test CLAUDE.md prescribes.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { countSolutions, difficultyLevel, logicSolves } from '../js/solver.js';
import { computeHint } from '../js/hint.js';
import { decodePuzzle, transformPuzzle, canonicalKey, isValidSolution } from '../js/levels.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS_DIR = join(ROOT, 'levels');
const LEVELS = { easy: 0, medium: 1, hard: 2 };

let failures = 0;
function fail(msg) {
  failures++;
  console.error(`FAIL ${msg}`);
}

function regionsContiguous(N, region) {
  const cells = Array.from({ length: N }, () => []);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cells[region[r][c]].push([r, c]);
  for (let id = 0; id < N; id++) {
    if (cells[id].length === 0) return false;
    const seen = new Set([cells[id][0].join(',')]);
    const queue = [cells[id][0]];
    while (queue.length) {
      const [r, c] = queue.pop();
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const r2 = r + dr;
        const c2 = c + dc;
        const k = `${r2},${c2}`;
        if (r2 >= 0 && r2 < N && c2 >= 0 && c2 < N && region[r2][c2] === id && !seen.has(k)) {
          seen.add(k);
          queue.push([r2, c2]);
        }
      }
    }
    if (seen.size !== cells[id].length) return false;
  }
  return true;
}

// Solve purely by following hints: place on `place`, mark on `eliminate`,
// never touch the board otherwise. A pool puzzle must reach all N queens on
// exactly the stored solution, or hints have drifted from generation.
function solveByHints(N, region, solution, label) {
  const queens = [];
  const marks = Array.from({ length: N }, () => new Array(N).fill(false));
  for (let steps = 0; steps < N * N * 4; steps++) {
    if (queens.length === N) break;
    const hint = computeHint(N, region, solution, queens, marks);
    if (hint.kind === 'place') {
      for (const [r, c] of hint.targetCells) queens.push([r, c]);
    } else if (hint.kind === 'eliminate') {
      for (const [r, c] of hint.targetCells) marks[r][c] = true;
    } else {
      fail(`${label}: hint solve got stuck on kind=${hint.kind} with ${queens.length}/${N} queens`);
      return;
    }
  }
  if (queens.length !== N) return fail(`${label}: hint solve never reached ${N} queens`);
  for (const [r, c] of queens)
    if (solution[r] !== c) return fail(`${label}: hint solve placed (${r},${c}) off the solution`);
}

const files = readdirSync(LEVELS_DIR).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error(`no pools in ${LEVELS_DIR} — run tools/generate-levels.mjs first`);
  process.exit(1);
}

for (const file of files) {
  const failuresBefore = failures;
  const bucket = JSON.parse(readFileSync(join(LEVELS_DIR, file), 'utf8'));
  const { n: N, difficulty, level, puzzles } = bucket;
  const label = file.replace('.json', '');
  const target = LEVELS[difficulty];

  if (bucket.v !== 1) fail(`${label}: unknown format version ${bucket.v}`);
  if (level !== target) fail(`${label}: level ${level} does not match difficulty ${difficulty}`);
  if (!Array.isArray(puzzles) || puzzles.length === 0) {
    fail(`${label}: empty pool`);
    continue;
  }

  const keys = new Set();
  const decodedPool = [];
  puzzles.forEach((entry, i) => {
    const id = `${label}[${i}]`;
    const decoded = decodePuzzle(N, entry);
    if (!decoded) return fail(`${id}: does not decode`);
    const { region, solution } = decoded;
    decodedPool.push(decoded);

    const idsUsed = new Set(region.flat());
    if (idsUsed.size !== N) fail(`${id}: expected ${N} region ids, got ${idsUsed.size}`);
    if (!regionsContiguous(N, region)) fail(`${id}: region not contiguous`);
    if (!isValidSolution(N, region, solution)) fail(`${id}: stored solution invalid`);
    if (countSolutions(N, region, 2) !== 1) fail(`${id}: solution not unique`);
    if (difficultyLevel(N, region) !== target) fail(`${id}: rating drifted from ${difficulty}`);
    if (!logicSolves(N, region, 2)) fail(`${id}: not solvable by explainable techniques`);

    const key = canonicalKey(N, region);
    if (keys.has(key)) fail(`${id}: D4 duplicate of another pool entry`);
    keys.add(key);

    for (let t = 0; t < 8; t++) {
      const tp = transformPuzzle(N, region, solution, t);
      if (!isValidSolution(N, tp.region, tp.solution)) fail(`${id} t=${t}: solution broken`);
      if (countSolutions(N, tp.region, 2) !== 1) fail(`${id} t=${t}: uniqueness broken`);
      if (difficultyLevel(N, tp.region) !== target) fail(`${id} t=${t}: rating changed`);
    }
  });

  if (decodedPool.length) {
    const pick = decodedPool[Math.floor(Math.random() * decodedPool.length)];
    const t = Math.floor(Math.random() * 8);
    const tp = transformPuzzle(N, pick.region, pick.solution, t);
    solveByHints(N, tp.region, tp.solution, `${label} (hint solve, t=${t})`);
  }
  if (failures === failuresBefore) console.log(`ok   ${label}: ${puzzles.length} puzzles`);
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log(`\nall ${files.length} pools verified`);
