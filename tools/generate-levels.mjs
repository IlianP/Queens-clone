// Precompute the puzzle pools served by js/levels.js (see CLAUDE.md →
// "Rätsel-Pools"). For every (size, difficulty) bucket this keeps generating
// until it has `--count` puzzles that match the target difficulty EXACTLY
// (generatePuzzle alone is best-effort and may return a near miss), are unique
// solutions (re-verified), and are no D4 rotation/mirror of one another.
//
//   node tools/generate-levels.mjs [--size N] [--difficulty easy|medium|hard]
//                                  [--count 50] [--seed <int>]
//                                  [--style organic|blocky|frame|mixed]
//                                  [--out-suffix <s>] [--top-up]
//
// --style picks the region-growth style (see js/generator.js): 'organic' is the
// flood fill the first pools were built with, 'blocky' the segment growth with
// straight borders and one big background region, 'frame' the outer-ring look,
// and 'mixed' fills each bucket from every style that bucket HAS (see `mixFor`),
// so ONE pool serves every look (each entry is tagged with the style it grew in).
// 'strips' is no longer shipped (see CLAUDE.md → "The strips style"), so it is
// not offered here.
//
// --top-up (mixed only) keeps the boards a bucket already holds, drops entries
// whose style the bucket no longer has, and generates only what is missing per
// style. It is how the strips boards were taken out without re-rolling the
// thousand boards around them. Combine with --out-suffix to
// build a trial pool next to the real one (e.g. `8-hard-blocky.json`) instead of
// overwriting it — handy for comparing styles side by side before committing.
//
// No flags = regenerate all 24 buckets (5..11 in all three difficulties plus
// hard-only at 12..14; minutes to tens of minutes — the N>=11 buckets dominate,
// exact-level hits there can take tens of seconds each). Re-run this (then
// tools/verify-levels.mjs) whenever generator/solver/difficulty logic changes,
// or stored ratings drift from the code.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { generatePuzzle } from '../js/generator.js';
import { countSolutions, difficultyLevel } from '../js/solver.js';
import { encodePuzzle, decodePuzzle, canonicalKey } from '../js/levels.js';

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

// From here up a bucket is blocky only. With strips gone (too easy: every board
// ran on line<->region confinement), blocky is the fastest remaining grower at
// these sizes — measured per accepted hard board at 13x13: blocky ~15 s,
// organic ~70 s (14x14 organic: ~170 s). A mixed bucket would be an overnight
// job for a look nobody could tell apart at that cell size anyway.
const BLOCKY_ONLY_FROM = 13;
// Generator budget per run. 4 s is plenty up to 12, but a 13x13 blocky board
// takes ~15 s, so a 4 s budget would end almost every run in the organic
// last-resort loop — rejected as off-style below, and the stall guard would fire.
const budgetFor = (N) => (N >= 14 ? 60000 : N >= BLOCKY_ONLY_FROM ? 30000 : 4000);

// Up to here a mixed bucket also draws 'frame'. Above it the style's uniqueness
// repair stops finishing in a usable time, and EASY gives out a size earlier
// again because easy needs the forced naked-single opening that frame's big
// outer regions rarely leave: ~2 s per easy board at 9 against ~47 s at 10, far
// too slow to fill a bucket. Keep in step with FRAME_MAX_* in js/main.js, which
// makes the same choice for live generation.
const FRAME_MAX_FROM = 10;
const FRAME_MAX_EASY_FROM = 9;

// Which styles a mixed bucket is filled from: organic + blocky everywhere below
// BLOCKY_ONLY_FROM, in as even a split as `count` allows, and 'frame' joins up
// to its own ceilings above. Keep in step with stylesFor() in js/main.js.
function mixFor(N, difficulty) {
  if (N >= BLOCKY_ONLY_FROM) return ['blocky'];
  const pool = ['organic', 'blocky'];
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
const topUp = args.includes('--top-up');

if (!['organic', 'blocky', 'frame', 'mixed'].includes(style)) {
  console.error("--style must be 'organic', 'blocky', 'frame' or 'mixed'");
  process.exit(1);
}
if (topUp && style !== 'mixed') {
  console.error('--top-up only makes sense with --style mixed');
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
  if (want <= 0) return;
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
  let fallbacks = 0;

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
    const p = generatePuzzle(N, difficulty, { budgetMs: budgetFor(N), rng, style: growStyle });
    // A board the requested grower did not produce cannot count towards its
    // quota. `generatePuzzle` puts fairness above style — when its budget runs
    // out the last-resort loop grows organic whatever was asked for — and
    // keeping one here would fill a `frame` slot with an organic board: the
    // bucket still holds `count` puzzles, but one style ends up short and
    // organic oversized, permanently, because the interleave below groups by
    // the (truthful) tag. Rare at a 4 s budget and silent when it happens, so
    // reject it here rather than hope. A style that can only ever come back
    // this way now trips the stall guard above, which is the honest outcome:
    // the bucket's mix is wrong.
    if (p.grownWith && p.grownWith !== growStyle) {
      fallbacks++;
      continue;
    }
    if (p.level !== target) continue; // exact level only — no near misses in the pool
    const key = canonicalKey(N, p.region);
    if (seen.has(key)) continue; // a rotation/mirror of a kept puzzle
    // Belt and braces before anything is written: unique + rated as labelled.
    if (countSolutions(N, p.region, 2) !== 1) continue;
    if (difficultyLevel(N, p.region) !== target) continue;
    seen.add(key);
    lastKeep = Date.now();
    // The style tag is provenance, not something the game reads: drawLevel
    // ignores it, verify-levels.mjs uses it to check the actual mix. It records
    // what GREW the board, which after the rejection above is necessarily the
    // style that was asked for — `?? growStyle` only covers an older generator
    // that does not report `grownWith` at all.
    puzzles.push({ ...encodePuzzle(N, p.region, p.solution), t: p.grownWith ?? growStyle });

    const nowMs = Date.now();
    if (nowMs - lastLog > 5000 || puzzles.length === goal) {
      console.log(
        `  ${N}-${difficulty} [${growStyle}]: ${puzzles.length}/${count} ` +
          `(${attempts} generator runs, ${((nowMs - start) / 1000).toFixed(1)}s` +
          `${fallbacks ? `, ${fallbacks} off-style rejected` : ''})`
      );
      lastLog = nowMs;
    }
  }
}

// The bucket as it is on disk, for --top-up. Null when there is none yet.
function readBucket(N, difficulty) {
  try {
    const data = JSON.parse(readFileSync(join(OUT_DIR, `${N}-${difficulty}${outSuffix}.json`), 'utf8'));
    return Array.isArray(data.puzzles) ? data.puzzles : null;
  } catch (e) {
    return null;
  }
}

function buildBucket(N, difficulty, rng) {
  const puzzles = [];
  const seen = new Set();
  if (style === 'mixed') {
    if (topUp) {
      // Keep what the bucket already holds in a style it still has; everything
      // else (today: the strips boards) is dropped. `seen` gets every kept shape
      // so a new board can't be a rotation of an old one.
      const allowed = mixFor(N, difficulty);
      const existing = readBucket(N, difficulty) || [];
      let dropped = 0;
      for (const p of existing) {
        if (!allowed.includes(p.t)) {
          dropped++;
          continue;
        }
        const dec = decodePuzzle(N, p);
        if (!dec) continue;
        seen.add(canonicalKey(N, dec.region));
        puzzles.push({ r: p.r, s: p.s, t: p.t });
      }
      if (dropped) console.log(`  ${N}-${difficulty}: dropped ${dropped} board(s) of a style no longer in the mix`);
    }
    // An even split over every style this bucket has, so one pool file serves
    // every look. drawLevel's shuffle bag then hands them out evenly and without
    // repeats — a steadier mix than flipping a coin per game, which would
    // happily deal five of one in a row.
    const styles = mixFor(N, difficulty);
    const base = Math.floor(count / styles.length);
    styles.forEach((s, i) => {
      // The remainder goes to the first styles, so the bucket holds exactly
      // `count` puzzles whether or not it divides evenly. On a top-up, what the
      // style already has counts towards its share (and a style already over its
      // share keeps its surplus rather than losing boards).
      const share = base + (i < count % styles.length ? 1 : 0);
      const have = puzzles.filter((p) => p.t === s).length;
      fillBucket(N, difficulty, rng, s, share - have, puzzles, seen);
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
