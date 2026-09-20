// Precompute the puzzle pools served by js/levels.js (see CLAUDE.md →
// "Rätsel-Pools"). For every (size, difficulty) bucket this keeps generating
// until it has `--count` puzzles that match the target difficulty EXACTLY
// (generatePuzzle alone is best-effort and may return a near miss), are unique
// solutions (re-verified), and are no D4 rotation/mirror of one another.
//
//   node tools/generate-levels.mjs [--size N] [--difficulty easy|medium|hard]
//                                  [--count 50] [--seed <int>]
//                                  [--style organic|blocky|strips|mixed]
//                                  [--out-suffix <s>]
//
// --style picks the region-growth style (see js/generator.js): 'organic' is the
// flood fill the first pools were built with, 'blocky' the segment growth with
// straight borders and one big background region, 'strips' the N-1 straight
// one-wide segments around a single background, and 'mixed' fills each bucket
// from every style that bucket HAS (see `mixFor`), so ONE pool serves every look
// (each entry is tagged with the style it grew in). Combine with --out-suffix to
// build a trial pool next to the real one (e.g. `8-hard-blocky.json`) instead of
// overwriting it — handy for comparing styles side by side before committing.
//
// No flags = regenerate all 24 buckets (5..11 in all three difficulties plus
// hard-only at 12..14; minutes to tens of minutes — the N>=11 buckets dominate,
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

const SIZES = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const LEVELS = { easy: 0, medium: 1, hard: 2 };

// A 12x12 board is inherently hard: puzzles the easy/medium techniques can
// solve essentially don't occur at that size (a naked-single-only 12x12 is
// vanishingly rare), so we only pool "hard" from there up — matching the
// hard-only difficulty lock the UI applies at size 12 and above.
const HARD_ONLY_FROM = 12;
const difficultiesFor = (N) => (N >= HARD_ONLY_FROM ? ['hard'] : DIFFICULTIES);

// Above this size only the strips style is practical. Measured per accepted hard
// board at 13x13: strips ~0.3 s, organic ~12 s, blocky worse still — a mixed
// 13/14 bucket would be an overnight job for the two thirds nobody could tell
// apart at that cell size anyway. This is what makes sizes beyond 12 exist at
// all, so it is a fact about the styles, not a shortcut.
const STRIPS_ONLY_FROM = 13;

// Up to here a mixed bucket also draws 'frame'. Above it the style's uniqueness
// repair stops finishing in a usable time, and EASY gives out a size earlier
// again because easy needs the forced naked-single opening that frame's big
// outer regions rarely leave: ~2 s per easy board at 9 against ~47 s at 10, far
// too slow to fill a bucket. Keep in step with FRAME_MAX_* in js/main.js, which
// makes the same choice for live generation.
const FRAME_MAX_FROM = 10;
const FRAME_MAX_EASY_FROM = 9;

// Which styles a mixed bucket is filled from. Easy has no strips boards at all
// (the size floor removes the forced naked-single opening easy IS — see
// js/generator.js), so an easy bucket stays organic + blocky; everything else
// gets all three, in as even a split as `count` allows. 'frame' joins both up to
// its own ceilings above.
function mixFor(N, difficulty) {
  if (N >= STRIPS_ONLY_FROM) return ['strips'];
  const pool = difficulty === 'easy' ? ['organic', 'blocky'] : ['organic', 'blocky', 'strips'];
  if (N <= (difficulty === 'easy' ? FRAME_MAX_EASY_FROM : FRAME_MAX_FROM)) pool.push('frame');
  return pool;
}

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

if (!['organic', 'blocky', 'strips', 'frame', 'mixed'].includes(style)) {
  console.error("--style must be 'organic', 'blocky', 'strips', 'frame' or 'mixed'");
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
  // The one combination that can never be satisfied: the strips style has no
  // easy boards (see js/generator.js), and the loop below only accepts an exact
  // level match — so without this it would spin forever rather than fail. mixFor
  // never asks for it; a hand-typed `--style strips --difficulty easy` would.
  if (growStyle === 'strips' && target === 0) {
    console.error(
      `${N}-${difficulty}: the 'strips' style has no easy boards — build easy with ` +
        "'organic', 'blocky', 'strips', 'frame' or 'mixed'."
    );
    process.exit(1);
  }
  const start = Date.now();
  let attempts = 0;
  let lastLog = start;
  const goal = puzzles.length + want;
  // A style whose share of a bucket it cannot actually produce would spin here
  // forever, and the log would just keep printing the same count — the build
  // looks busy rather than stuck. That stopped being hypothetical once a fourth
  // style joined the mix with size-dependent viability ('frame' needs ~2 s per
  // easy board at 9x9 and ~47 s at 10x10, which is why mixFor drops it from easy
  // there). So give up loudly instead: no board kept for this long means the
  // bucket's mix is wrong, not that the machine is slow.
  const STALL_MS = 10 * 60 * 1000;
  let lastKeep = start;

  while (puzzles.length < goal) {
    attempts++;
    if (Date.now() - lastKeep > STALL_MS) {
      console.error(
        `\n${N}-${difficulty} [${growStyle}]: no board kept in ${STALL_MS / 60000} min ` +
          `(${attempts} generator runs, ${puzzles.length}/${goal} done).\n` +
          `That style cannot fill its share of this bucket — fix mixFor() rather ` +
          `than waiting it out.`
      );
      process.exit(1);
    }
    const p = generatePuzzle(N, difficulty, { budgetMs: 4000, rng, style: growStyle });
    if (p.level !== target) continue; // exact level only — no near misses in the pool
    const key = canonicalKey(N, p.region);
    if (seen.has(key)) continue; // a rotation/mirror of a kept puzzle
    // Belt and braces before anything is written: unique + rated as labelled.
    if (countSolutions(N, p.region, 2) !== 1) continue;
    if (difficultyLevel(N, p.region) !== target) continue;
    seen.add(key);
    lastKeep = Date.now();
    // The style tag is provenance, not something the game reads: drawLevel
    // ignores it, verify-levels.mjs uses it to report the actual mix.
    //
    // Tag what GREW the board, not what was asked for. `generatePuzzle` puts
    // fairness above style — when its budget runs out the last-resort loop
    // grows organic whatever the request was — so tagging `growStyle` would
    // file those boards under a style that never touched them, and the "even
    // split per bucket" verify-levels reports would be measuring the request
    // rather than the pool. Rare at these budgets, and silent when it happens.
    puzzles.push({ ...encodePuzzle(N, p.region, p.solution), t: p.grownWith ?? growStyle });

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
    // An even split over every style this bucket has, so one pool file serves
    // every look. drawLevel's shuffle bag then hands them out evenly and without
    // repeats — a steadier mix than flipping a coin per game, which would
    // happily deal five of one in a row.
    const styles = mixFor(N, difficulty);
    const base = Math.floor(count / styles.length);
    styles.forEach((s, i) => {
      // The remainder goes to the first styles, so the bucket holds exactly
      // `count` puzzles whether or not it divides evenly.
      const want = base + (i < count % styles.length ? 1 : 0);
      fillBucket(N, difficulty, rng, s, want, puzzles, seen);
    });
    // Interleave so a truncated or partially-read pool is still mixed.
    const byStyle = styles.map((s) => puzzles.filter((p) => p.t === s));
    puzzles.length = 0;
    for (let i = 0; i < Math.max(...byStyle.map((g) => g.length)); i++)
      for (const group of byStyle) if (group[i]) puzzles.push(group[i]);
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
