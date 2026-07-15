// Bundle the app into ONE self-contained HTML file, for publishing as an
// Artifact so a branch can be tested on a phone (see CLAUDE.md → "Testing a
// branch on mobile"). Generated FROM the real sources so it mirrors the branch.
//
//   node tools/build-artifact.mjs [output.html]
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

// Strip ESM glue so the files share one classic-script scope. (Relies on there
// being no top-level name collisions across modules — true today; verify with
// `grep -nE '^(export )?(const|let|var|function|class)'` if you add files.)
function strip(code) {
  return code
    // Drop import statements — single- OR multi-line, up to the terminating ';'.
    .replace(/^\s*import\s[\s\S]*?;[ \t]*$/gm, '')
    .replace(/^\s*export\s+((?:async\s+)?(?:const|let|var|function|class))\b/gm, '$1');
}

const settings = strip(read('js/settings.js'));
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
const levelsDir = join(ROOT, 'levels');
const pools = {};
if (existsSync(levelsDir)) {
  for (const f of readdirSync(levelsDir).filter((f) => f.endsWith('.json')).sort()) {
    pools[f.replace('.json', '')] = JSON.parse(readFileSync(join(levelsDir, f), 'utf8'));
  }
}
if (Object.keys(pools).length === 0) {
  console.warn('warning: no levels/*.json found — bundle will fall back to live generation');
}

// Point the worker at the blob URL instead of a sibling module file.
const workerExpr = "new Worker(new URL('./generator.worker.js', import.meta.url), { type: 'module' })";
if (!main.includes(workerExpr)) throw new Error('worker construction line not found — bundle would break');
main = main.replace(workerExpr, 'new Worker(__WORKER_URL__)');

// Classic worker source: solver + generator + a plain message handler.
const workerSrc =
  solver + '\n' + generator + '\n' +
  'self.onmessage = function (e) {\n' +
  '  var d = e.data;\n' +
  '  self.postMessage(generatePuzzle(d.N, d.difficulty, { budgetMs: d.budgetMs }));\n' +
  '};\n';

// Page bundle: settings -> solver -> generator -> levels -> highscores ->
// game -> hint -> leaderboard -> main (boots). The online leaderboard's fetch
// calls are CSP-blocked inside the Artifact, so it stays disabled there and the
// bundle runs local-only — the same graceful fallback the game uses elsewhere.
const pageBundle = [settings, solver, generator, levels, highscores, game, hint, leaderboard, main].join(
  '\n\n'
);

// Safety net: a surviving `import`/`export` means strip() missed a form (e.g. a
// new multi-line import) and the classic-script bundle would throw at load.
if (/^\s*(import|export)\s/m.test(pageBundle)) {
  throw new Error('bundle still contains an import/export statement — strip() needs updating');
}

const css = read('css/styles.css');

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
