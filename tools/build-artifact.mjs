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
import { readFileSync, writeFileSync } from 'node:fs';
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
    .replace(/^\s*import\s.*?;\s*$/gm, '')
    .replace(/^\s*export\s+(const|let|var|function|class)\b/gm, '$1');
}

const settings = strip(read('js/settings.js'));
const solver = strip(read('js/solver.js'));
const generator = strip(read('js/generator.js'));
const game = strip(read('js/game.js'));
const hint = strip(read('js/hint.js'));
let main = strip(read('js/main.js'));

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

// Page bundle: settings -> solver -> generator -> game -> hint -> main (boots).
const pageBundle = [settings, solver, generator, game, hint, main].join('\n\n');

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
