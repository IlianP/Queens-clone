// build-artifact.mjs — bundle the multi-file ESM game (plus its Web Worker) into
// a single self-contained HTML fragment for publishing as an Artifact so the
// branch can be tested on a phone. No build tooling: it concatenates the real
// sources in dependency order (settings -> solver -> generator -> game -> hint ->
// main), strips import/export, and rebuilds the module worker as a classic
// Blob-URL worker (module workers and external URLs are CSP-blocked in the
// Artifact sandbox; the game's own generateAsync fallback covers a sandbox that
// blocks blob workers too). Output: dist/queens-artifact.html (body-only content
// the Artifact skeleton wraps; a <meta charset> is emitted for standalone use).
//
//   node build-artifact.mjs
//
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

// Drop ESM plumbing: `import ... ;` lines and the leading `export ` keyword.
function strip(src) {
  return src
    .replace(/^\s*import\s+[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
}

const settings = strip(read('js/settings.js'));
const solver = strip(read('js/solver.js'));
const generator = strip(read('js/generator.js'));
const game = strip(read('js/game.js'));
const hint = strip(read('js/hint.js'));
let main = strip(read('js/main.js'));

// Rebuild the module worker as a classic Blob worker: it needs the pure solver +
// generator in scope, then relays generatePuzzle results.
const workerSrc =
  solver +
  '\n' +
  generator +
  '\n' +
  'self.onmessage = (e) => {\n' +
  '  const { N, difficulty, budgetMs } = e.data;\n' +
  '  self.postMessage(generatePuzzle(N, difficulty, { budgetMs }));\n' +
  '};\n';

// Swap the module-worker construction for a Blob-URL classic worker. The
// try/catch + onerror fallback in generateAsync stays intact, so a sandbox that
// forbids blob workers falls back to synchronous generation on the main thread.
main = main.replace(
  /new Worker\(new URL\([^)]*\),\s*\{\s*type:\s*'module'\s*\}\)/,
  "new Worker(URL.createObjectURL(new Blob([__WORKER_SRC__], { type: 'application/javascript' })))"
);

const bundleJs =
  'const __WORKER_SRC__ = ' +
  JSON.stringify(workerSrc) +
  ';\n' +
  [settings, solver, generator, game, hint, main].join('\n');

const css = read('css/styles.css');

// Body-only content of index.html: strip the outer document shell, the external
// stylesheet link, and the module <script> tag (replaced by the inline bundle).
const html = read('index.html');
const bodyInner = html
  .replace(/[\s\S]*<body>/i, '')
  .replace(/<\/body>[\s\S]*/i, '')
  .replace(/<script[^>]*src=["']\.\/js\/main\.js["'][^>]*><\/script>/i, '')
  .trim();

const out =
  '<meta charset="utf-8" />\n' +
  '<title>Queens</title>\n' +
  '<style>\n' +
  css +
  '\n</style>\n' +
  bodyInner +
  '\n<script>\n' +
  bundleJs +
  '\n</script>\n';

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/queens-artifact.html'), out, 'utf8');
console.log('wrote dist/queens-artifact.html (' + out.length + ' bytes)');
