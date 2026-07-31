// Bundle the app into ONE self-contained HTML file, for publishing as an
// Artifact so a branch can be tested on a phone (see CLAUDE.md → "Testing a
// branch on mobile"). Generated FROM the real sources so it mirrors the branch.
//
//   node tools/build-artifact.mjs [output.html] [--style blocky]
//
// --style blocky builds a *trial* bundle of the blocky region-growth style (see
// CLAUDE.md → "Region-growth styles") without touching what the site serves: it
// embeds the `levels/<N>-<difficulty>-blocky.json` pools under the plain keys
// js/levels.js looks up, and makes both generation paths — the worker and
// main.js's synchronous fallback — pass `style: 'blocky'`. Handing that bundle to
// a phone is how the style gets judged before anything about the default changes.
//
// The Web Worker is rebuilt as a *classic* worker from a Blob URL: module
// workers and external URLs are blocked by the Artifact CSP. If the sandbox
// blocks blob workers too, the game's own fallback runs generation synchronously
// and the reveal still plays.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const css = read('css/styles.css');

const argv = process.argv.slice(2);
const styleIdx = argv.indexOf('--style');
const style = styleIdx >= 0 ? argv[styleIdx + 1] : 'mixed';
if (!['organic', 'blocky', 'mixed'].includes(style)) {
  console.error("--style must be 'organic', 'blocky' or 'mixed'");
  process.exit(1);
}
// 'mixed' is what the app itself does — the shipped pools already hold both
// looks, so it needs no override at all. The single-style builds are the trial
// bundles: they read a `-<style>` pool and pin live generation to match.
const POOL_SUFFIX = style === 'mixed' ? '' : `-${style}`;

// Strip ESM glue so the files share one classic-script scope. (Relies on there
// being no top-level name collisions across modules — true today; verify with
// `grep -nE '^(export )?(const|let|var|function|class)'` if you add files.)
function strip(code) {
  return code
    // Drop import statements — single- OR multi-line, up to the terminating ';'.
    .replace(/^\s*import\s[\s\S]*?;[ \t]*$/gm, '')
    .replace(/^\s*export\s+((?:async\s+)?(?:const|let|var|function|class))\b/gm, '$1');
}

const i18nEn = strip(read('js/i18n/en.js'));
const i18nDe = strip(read('js/i18n/de.js'));
const i18n = strip(read('js/i18n.js'));
const settings = strip(read('js/settings.js'));
const audio = strip(read('js/audio.js'));
const voice = strip(read('js/voice.js'));
const solver = strip(read('js/solver.js'));
const generator = strip(read('js/generator.js'));
const levels = strip(read('js/levels.js'));
const highscores = strip(read('js/highscores.js'));
const game = strip(read('js/game.js'));
const hint = strip(read('js/hint.js'));
const leaderboard = strip(read('js/leaderboard.js'));
let main = strip(read('js/main.js'));

// The Artifact CSP blocks fetch, so the level pools are embedded as the
// global js/levels.js checks before fetching. Guard the handshake like the
// worker line: if the global's name changes, the embed must not silently rot.
if (!levels.includes('__QUEENS_LEVELS__')) {
  throw new Error('js/levels.js no longer reads __QUEENS_LEVELS__ — pool embed would break');
}
// Only the requested style's pools go in, and always under the plain
// `<N>-<difficulty>` key — that's what drawLevel() asks for, so a trial pool is
// picked up without js/levels.js knowing styles exist.
const levelsDir = join(ROOT, 'levels');
const pools = {};
if (existsSync(levelsDir)) {
  const wanted = new RegExp(`^(\\d+-(?:easy|medium|hard))${POOL_SUFFIX}\\.json$`);
  for (const f of readdirSync(levelsDir).sort()) {
    const m = wanted.exec(f);
    if (m) pools[m[1]] = JSON.parse(readFileSync(join(levelsDir, f), 'utf8'));
  }
}
// A single-style build with no matching pools is a mistake, not a fallback: the
// bundle would silently generate every board live (slow, and no pool means no
// difficulty guarantee up front). Say which command produces them and stop.
if (Object.keys(pools).length === 0 && style !== 'mixed') {
  console.error(
    `no levels/*${POOL_SUFFIX}.json pools found.\n` +
      `Build them first:\n` +
      `  node tools/generate-levels.mjs --style ${style} --out-suffix ${POOL_SUFFIX}`
  );
  process.exit(1);
}
if (Object.keys(pools).length === 0) {
  console.warn(
    `warning: no levels/*${POOL_SUFFIX}.json found — bundle will fall back to live generation`
  );
}

// Point the worker at the blob URL instead of a sibling module file.
const workerExpr = "new Worker(new URL('./generator.worker.js', import.meta.url), { type: 'module' })";
if (!main.includes(workerExpr)) throw new Error('worker construction line not found — bundle would break');
main = main.replace(workerExpr, 'new Worker(__WORKER_URL__)');

// Live generation is the fallback whenever a pool draw fails, so a single-style
// bundle has to pin that path too — otherwise the one board that slips past the
// pool comes back in the other look. main.js routes every generation path
// (worker and both inline fallbacks) through randomStyle(), so overriding that
// one function covers all of them. Guarded: a rename must fail the build rather
// than silently leave the bundle mixed.
if (style !== 'mixed') {
  const coinFlip = "return Math.random() < 0.5 ? 'organic' : 'blocky';";
  if (!main.includes(coinFlip)) {
    throw new Error('randomStyle() body not found — single-style bundle would stay mixed');
  }
  main = main.replace(coinFlip, `return '${style}';`);
}

// Classic worker source: solver + generator + a plain message handler.
const workerSrc =
  solver + '\n' + generator + '\n' +
  'self.onmessage = function (e) {\n' +
  '  var d = e.data;\n' +
  '  self.postMessage(generatePuzzle(d.N, d.difficulty, { budgetMs: d.budgetMs, style: d.style }));\n' +
  '};\n';

// Page bundle: i18n packs -> i18n -> settings -> audio -> voice -> solver ->
// generator -> levels -> highscores -> game -> hint -> leaderboard -> main
// (boots). The language packs come FIRST because js/i18n.js builds I18N_PACKS
// from them in a top-level `const`: in one shared scope a later declaration
// would be in the temporal dead zone and the bundle would throw at load. The online
// leaderboard's fetch calls are CSP-blocked inside the Artifact, so it stays
// disabled there and the bundle runs local-only — the same graceful fallback the
// game uses elsewhere. (The synthesised sounds need no assets, so they work
// under the Artifact CSP unchanged. Voice Mode degrades the same way: the
// sandboxed Artifact frame can't grant mic access, so voiceSupported() gates it
// off there and the panel simply doesn't run.)
const pageBundle = [
  i18nEn, i18nDe, i18n,
  settings, audio, voice, solver, generator, levels, highscores, game, hint, leaderboard, main,
].join('\n\n');

// The bundle has no <html> element to carry a lang attribute and no <head> the
// body slice would pick up, so the shell's reveal hook has to be there. Guard
// it: without `data-i18n-ready` the CSS gate never lifts and the Artifact opens
// on a blank page (see applyTranslations in js/main.js).
if (!main.includes('data-i18n-ready') || !css.includes('data-i18n-ready')) {
  throw new Error('the i18n reveal hook (data-i18n-ready) is missing — bundle would render blank');
}

// Safety net: a surviving `import`/`export` means strip() missed a form (e.g. a
// new multi-line import) and the classic-script bundle would throw at load.
if (/^\s*(import|export)\s/m.test(pageBundle)) {
  throw new Error('bundle still contains an import/export statement — strip() needs updating');
}

// Body markup from index.html, minus the module <script> (inlined below).
const html = read('index.html');
let body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
body = body.replace(/<script[^>]*type="module"[^>]*><\/script>\s*/g, '');

// charset first (before the big CSS) so it lands within the first 1 KB and the
// German text + emoji decode as UTF-8 no matter how the file is served.
const out = `<meta charset="utf-8">
<title>Queens</title>
<style>
${css}
</style>
${body}
<script>
"use strict";
var __QUEENS_LEVELS__ = ${JSON.stringify(pools)};
var __WORKER_URL__ = null;
try {
  var __WORKER_SRC__ = ${JSON.stringify(workerSrc)};
  __WORKER_URL__ = URL.createObjectURL(new Blob([__WORKER_SRC__], { type: 'application/javascript' }));
} catch (e) { /* no blob worker -> game falls back to synchronous generation */ }

${pageBundle}
</script>
`;

const dest = process.argv[2] || join(tmpdir(), 'queens-preview.html');
writeFileSync(dest, out);
console.log(`wrote ${dest} (${(out.length / 1024).toFixed(1)} KB)`);
