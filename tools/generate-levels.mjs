// Precompute the puzzle pools served by js/levels.js (see CLAUDE.md →
// "Rätsel-Pools"). For every (size, difficulty) bucket this keeps generating
// until it has `--count` puzzles that match the target difficulty EXACTLY
// (generatePuzzle alone is best-effort and may return a near miss), are unique
// solutions (re-verified), and are no D4 rotation/mirror of one another.
//
//   node tools/generate-levels.mjs [--size N] [--difficulty easy|medium|hard]
//                                  [--count 50] [--seed <int>]
//
// No flags = regenerate all 21 buckets (minutes; the N=11 buckets dominate —
// exact-level hits there can take ~10 s each). Re-run this (then
// tools/verify-levels.mjs) whenever generator/solver/difficulty logic changes,
// or stored ratings drift from the code.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { generatePuzzle } from '../js/generator.js';
import { countSolutions, difficultyLevel } from '../js/solver.js';
import { encodePuzzle, canonicalKey } from '../js/levels.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'levels');

const SIZES = [5, 6, 7, 8, 9, 10, 11];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const LEVELS = { easy: 0, medium: 1, hard: 2 };

// ---------- CLI ----------
const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const onlySize = argValue('--size') ? Number(argValue('--size')) : null;
const onlyDifficulty = argValue('--difficulty');
const count = argValue('--count') ? Number(argValue('--count')) : 50;
const seed = argValue('--seed') ? Number(argValue('--seed')) : (Math.random() * 2 ** 32) >>> 0;

if (onlySize !== null && !SIZES.includes(onlySize)) {
  console.error(`--size must be one of ${SIZES.join(', ')}`);
  process.exit(1);
}
if (onlyDifficulty !== null && !DIFFICULTIES.includes(onlyDifficulty)) {
  console.error(`--difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  process.exit(1);
}

// Seeded so a pool build is reproducible; the seed is always printed.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBucket(N, difficulty, rng) {
  const target = LEVELS[difficulty];
  const start = Date.now();
  const puzzles = [];
  const seen = new Set();
  let attempts = 0;
  let lastLog = start;

  while (puzzles.length < count) {
    attempts++;
    const p = generatePuzzle(N, difficulty, { budgetMs: 4000, rng });
    if (p.level !== target) continue; // exact level only — no near misses in the pool
    const key = canonicalKey(N, p.region);
    if (seen.has(key)) continue; // a rotation/mirror of a kept puzzle
    // Belt and braces before anything is written: unique + rated as labelled.
    if (countSolutions(N, p.region, 2) !== 1) continue;
    if (difficultyLevel(N, p.region) !== target) continue;
    seen.add(key);
    puzzles.push(encodePuzzle(N, p.region, p.solution));

    const nowMs = Date.now();
    if (nowMs - lastLog > 5000 || puzzles.length === count) {
      console.log(
        `  ${N}-${difficulty}: ${puzzles.length}/${count} ` +
          `(${attempts} generator runs, ${((nowMs - start) / 1000).toFixed(1)}s)`
      );
      lastLog = nowMs;
    }
  }
  return { v: 1, n: N, difficulty, level: target, puzzles };
}

// One puzzle per line so pool diffs stay reviewable.
function serialize(bucket) {
  const rows = bucket.puzzles.map((p) => `    { "r": "${p.r}", "s": "${p.s}" }`);
  return (
    `{\n  "v": ${bucket.v},\n  "n": ${bucket.n},\n` +
    `  "difficulty": "${bucket.difficulty}",\n  "level": ${bucket.level},\n` +
    `  "puzzles": [\n${rows.join(',\n')}\n  ]\n}\n`
  );
}

mkdirSync(OUT_DIR, { recursive: true });
console.log(`seed ${seed}, ${count} puzzles per bucket`);
const t0 = Date.now();
for (const N of onlySize !== null ? [onlySize] : SIZES) {
  for (const difficulty of onlyDifficulty !== null ? [onlyDifficulty] : DIFFICULTIES) {
    // Bucket-specific stream so --size/--difficulty reruns of one bucket don't
    // shift the puzzles every other bucket would draw from the shared seed.
    const rng = mulberry32((seed ^ (N * 31 + LEVELS[difficulty])) >>> 0);
    const bucket = buildBucket(N, difficulty, rng);
    const file = join(OUT_DIR, `${N}-${difficulty}.json`);
    writeFileSync(file, serialize(bucket));
    console.log(`wrote ${file}`);
  }
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
