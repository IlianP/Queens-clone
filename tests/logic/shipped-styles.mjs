// Which region-growth styles the game actually serves, and that 'strips' is not
// one of them any more. Run with plain Node:
//
//   node tests/logic/shipped-styles.mjs
//
// 'strips' was shipped and then removed on purpose: its one-wide segments let a
// player rule out whole lines at a glance, so every board ran on line<->region
// confinement and played too easy (see CLAUDE.md → "The strips style"). The
// grower still exists as an experimental, measurable construction — which is
// exactly why nothing would notice it creeping back into play through a pool
// rebuild or a one-word edit to a style list. This pins the three places that
// decide what a player gets:
//
//   1. every served pool (levels/<N>-<difficulty>.json) holds only shipped tags,
//      and is full (13/14 had to be rebuilt from blocky when strips went),
//   2. mixFor() in tools/generate-levels.mjs never names 'strips', and
//   3. stylesFor() in js/main.js — the live-generation twin — never does either,
//      and the two agree on what sizes >= 13 are built from.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHIPPED = ['organic', 'blocky', 'frame'];
const POOL_SIZE = 50;

let failures = 0;
const check = (ok, msg) => {
  if (ok) console.log(`ok    ${msg}`);
  else {
    failures++;
    console.error(`FAIL  ${msg}`);
  }
};

// 1. The served pools. Single-style reference pools (`*-blocky.json`) are inert
// and not looked at here.
const served = readdirSync(join(ROOT, 'levels')).filter((f) => /^\d+-(easy|medium|hard)\.json$/.test(f));
check(served.length === 24, `24 served pool files (got ${served.length})`);
let bad = 0;
for (const f of served) {
  const { puzzles } = JSON.parse(readFileSync(join(ROOT, 'levels', f), 'utf8'));
  const tags = puzzles.map((p) => p.t);
  const foreign = tags.filter((t) => !SHIPPED.includes(t));
  if (foreign.length) {
    bad++;
    console.error(`      ${f}: ${foreign.length} entr${foreign.length === 1 ? 'y' : 'ies'} tagged ${[...new Set(foreign)].join(', ')}`);
  }
  if (puzzles.length !== POOL_SIZE) {
    bad++;
    console.error(`      ${f}: ${puzzles.length} boards, expected ${POOL_SIZE}`);
  }
}
check(bad === 0, `every served pool is full and holds only ${SHIPPED.join('/')} boards`);

// 2 + 3. The two style lists, read out of the sources rather than imported:
// main.js touches the DOM and generate-levels.mjs runs a build on import.
function functionBody(file, name) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}
const mixFor = functionBody('tools/generate-levels.mjs', 'mixFor');
const stylesFor = functionBody('js/main.js', 'stylesFor');
check(!!mixFor && !!stylesFor, 'found mixFor() and stylesFor() in the sources');
check(mixFor && !mixFor.includes("'strips'"), "mixFor() does not offer 'strips'");
check(stylesFor && !stylesFor.includes("'strips'"), "stylesFor() does not offer 'strips'");
check(
  mixFor && stylesFor && mixFor.includes("return ['blocky']") && stylesFor.includes("return ['blocky']"),
  'both build sizes >= 13 from blocky alone'
);

console.log(failures ? `\nshipped-styles: ${failures} failure(s)` : '\nshipped-styles: all checks passed');
process.exit(failures ? 1 : 0);
