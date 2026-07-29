// Precompute the puzzle pools served by js/levels.js (see CLAUDE.md →
// "Rätsel-Pools"). For every (size, difficulty) bucket this keeps generating
// until it has `--count` puzzles that match the target difficulty EXACTLY
// (generatePuzzle alone is best-effort and may return a near miss), are unique
// solutions (re-verified), and are no D4 rotation/mirror of one another.
//
//   node tools/generate-levels.mjs [--size N] [--difficulty easy|medium|hard]
//                                  [--count 50] [--seed <int>]
//                                  [--style organic|blocky|mixed] [--out-suffix <s>]
//
// --style picks the region-growth style (see js/generator.js): 'organic' is the
// flood fill the shipped pools were built with, 'blocky' the segment growth with
// straight borders and one big background region, and 'mixed' fills each bucket
// half and half so ONE pool serves both looks (each entry is tagged with the
// style it grew in). Combine with --out-suffix to
// build a trial pool next to the real one (e.g. `8-hard-blocky.json`) instead of
// overwriting it — handy for comparing the two styles side by side before
// committing to one.
//
// No flags = regenerate all 22 buckets (5..11 in all three difficulties plus
// hard-only at 12; minutes to tens of minutes — the N>=11 buckets dominate,
// exact-level hits there can take tens of seconds each). Re-run this (then
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

const SIZES = [5, 6, 7, 8, 9, 10, 11, 12];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const LEVELS = { easy: 0, medium: 1, hard: 2 };

// A 12x12 board is inherently hard: puzzles the easy/medium techniques can
// solve essentially don't occur at that size (a naked-single-only 12x12 is
// vanishingly rare), so we only pool "hard" there — matching the hard-only
// difficulty lock the UI applies at size 12.
const HARD_ONLY_FROM = 12;
const difficultiesFor = (N) => (N >= HARD_ONLY_FROM ? ['hard'] : DIFFICULTIES);

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
const style = argValue('--style') || 'organic';
const outSuffix = argValue('--out-suffix') || '';

if (!['organic', 'blocky', 'mixed'].includes(style)) {
  console.error("--style must be 'organic', 'blocky' or 'mixed'");
  process.exit(1);
}

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

// Fill one bucket with `want` puzzles grown in `growStyle`, appending to
// `puzzles` and sharing `seen` so the two halves of a mixed bucket can never
// contain the same shape (or a rotation of it) twice.
function fillBucket(N, difficulty, rng, growStyle, want, puzzles, seen) {
  const target = LEVELS[difficulty];
  const start = Date.now();
  let attempts = 0;
  let lastLog = start;
  const goal = puzzles.length + want;

  while (puzzles.length < goal) {
    attempts++;
    const p = generatePuzzle(N, difficulty, { budgetMs: 4000, rng, style: growStyle });
    if (p.level !== target) continue; // exact level only — no near misses in the pool
    const key = canonicalKey(N, p.region);
    if (seen.has(key)) continue; // a rotation/mirror of a kept puzzle
    // Belt and braces before anything is written: unique + rated as labelled.
    if (countSolutions(N, p.region, 2) !== 1) continue;
    if (difficultyLevel(N, p.region) !== target) continue;
    seen.add(key);
    // The style tag is provenance, not something the game reads: drawLevel
    // ignores it, verify-levels.mjs uses it to report the actual mix.
    puzzles.push({ ...encodePuzzle(N, p.region, p.solution), t: growStyle });

    const nowMs = Date.now();
    if (nowMs - lastLog > 5000 || puzzles.length === goal) {
      console.log(
        `  ${N}-${difficulty} [${growStyle}]: ${puzzles.length}/${count} ` +
          `(${attempts} generator runs, ${((nowMs - start) / 1000).toFixed(1)}s)`
      );
      lastLog = nowMs;
    }
  }
}

function buildBucket(N, difficulty, rng) {
  const puzzles = [];
  const seen = new Set();
  if (style === 'mixed') {
    // Half of each, so one pool file serves both looks. drawLevel's shuffle bag
    // then hands them out evenly and without repeats — a steadier mix than
    // flipping a coin per game, which would happily deal five of one in a row.
    const half = Math.floor(count / 2);
    fillBucket(N, difficulty, rng, 'organic', half, puzzles, seen);
    fillBucket(N, difficulty, rng, 'blocky', count - half, puzzles, seen);
    // Interleave so a truncated or partially-read pool is still mixed.
    puzzles.sort((a, b) => (a.t === b.t ? 0 : a.t === 'organic' ? -1 : 1));
    const organic = puzzles.filter((p) => p.t === 'organic');
    const blocky = puzzles.filter((p) => p.t === 'blocky');
    puzzles.length = 0;
    for (let i = 0; i < Math.max(organic.length, blocky.length); i++) {
      if (organic[i]) puzzles.push(organic[i]);
      if (blocky[i]) puzzles.push(blocky[i]);
    }
  } else {
    fillBucket(N, difficulty, rng, style, count, puzzles, seen);
  }
  return { v: 1, n: N, difficulty, level: LEVELS[difficulty], puzzles };
}

// One puzzle per line so pool diffs stay reviewable.
function serialize(bucket) {
  const rows = bucket.puzzles.map(
    (p) => `    { "r": "${p.r}", "s": "${p.s}"${p.t ? `, "t": "${p.t}"` : ''} }`
  );
  return (
    `{\n  "v": ${bucket.v},\n  "n": ${bucket.n},\n` +
    `  "difficulty": "${bucket.difficulty}",\n  "level": ${bucket.level},\n` +
    `  "puzzles": [\n${rows.join(',\n')}\n  ]\n}\n`
  );
}

mkdirSync(OUT_DIR, { recursive: true });
console.log(`seed ${seed}, ${count} puzzles per bucket, style ${style}`);
const t0 = Date.now();
for (const N of onlySize !== null ? [onlySize] : SIZES) {
  const buildable = difficultiesFor(N);
  for (const difficulty of onlyDifficulty !== null ? [onlyDifficulty] : buildable) {
    if (!buildable.includes(difficulty)) {
      console.log(`skip ${N}-${difficulty}: size ${N} is hard-only`);
      continue;
    }
    // Bucket-specific stream so --size/--difficulty reruns of one bucket don't
    // shift the puzzles every other bucket would draw from the shared seed.
    const rng = mulberry32((seed ^ (N * 31 + LEVELS[difficulty])) >>> 0);
    const bucket = buildBucket(N, difficulty, rng);
    const file = join(OUT_DIR, `${N}-${difficulty}${outSuffix}.json`);
    writeFileSync(file, serialize(bucket));
    console.log(`wrote ${file}`);
  }
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
