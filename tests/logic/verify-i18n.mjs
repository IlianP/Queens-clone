// Pure-Node consistency check for the language packs in js/i18n/.
//
// This is the guard that makes adding a language safe: nothing here judges a
// translation (no machine can), but everything that CAN be checked mechanically
// is checked, so a pack cannot silently rot —
//
//   1. every pack carries exactly the fallback's key set (no missing, no extra),
//   2. a key is a string in every pack or a function in every pack (a function
//      turned into a plain string would silently swallow its parameters),
//   3. every function value runs and returns a non-empty string,
//   4. a translation uses every parameter the fallback uses (dropping one loses
//      information the sentence was built to carry — e.g. the rank in "3rd-best
//      of 12 games"),
//   5. every key index.html references via data-i18n* exists,
//   6. every literal t('…') key in js/ exists.
//
// It lives in tests/logic/ so CI runs it automatically (.github/workflows/ci.yml
// iterates over tests/logic/*.mjs) — key drift is a red build, not a review
// item.
//
// Run: node tests/logic/verify-i18n.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { I18N_PACKS, I18N_FALLBACK, I18N_LANGUAGES } = await import('../../js/i18n.js');

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL: ' + msg);
};

const fallbackPack = I18N_PACKS[I18N_FALLBACK];
const fallbackKeys = Object.keys(fallbackPack);
const codes = Object.keys(I18N_PACKS);

// Which params a template function reads: call it with a Proxy that records
// every property access. Templates are plain string interpolation, so reading
// the params object is all they do.
function paramsUsedBy(fn) {
  const used = new Set();
  const probe = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        used.add(prop);
        // A number satisfies both arithmetic and interpolation; the few boolean
        // params (e.g. `many`, `capped`) only pick a branch, and either branch
        // is fine here — we're recording access, not asserting output.
        return 1;
      },
    }
  );
  try {
    fn(probe);
  } catch (e) {
    return { used, error: e };
  }
  return { used, error: null };
}

// --- 0) every listed language has a pack, and vice versa --------------------
for (const { code } of I18N_LANGUAGES) {
  if (!I18N_PACKS[code]) fail(`I18N_LANGUAGES lists "${code}" but there is no pack for it`);
}
for (const code of codes) {
  if (!I18N_LANGUAGES.some((l) => l.code === code)) {
    fail(`pack "${code}" exists but is not offered in I18N_LANGUAGES (unreachable)`);
  }
}
if (!fallbackPack) fail(`the fallback language "${I18N_FALLBACK}" has no pack`);

// --- 1..4) pack-to-pack consistency ----------------------------------------
for (const code of codes) {
  if (code === I18N_FALLBACK) continue;
  const pack = I18N_PACKS[code];
  const keys = new Set(Object.keys(pack));

  for (const key of fallbackKeys) {
    if (!keys.has(key)) {
      fail(`[${code}] missing key "${key}"`);
      continue;
    }
    const a = fallbackPack[key];
    const b = pack[key];
    const typeA = typeof a === 'function' ? 'function' : typeof a;
    const typeB = typeof b === 'function' ? 'function' : typeof b;
    if (typeA !== typeB) {
      fail(`[${code}] "${key}" is a ${typeB}, but ${I18N_FALLBACK} has a ${typeA}`);
      continue;
    }
    if (typeB === 'string') {
      if (!b.trim()) fail(`[${code}] "${key}" is empty`);
      continue;
    }
    const want = paramsUsedBy(a);
    const got = paramsUsedBy(b);
    if (got.error) {
      fail(`[${code}] "${key}" threw when called: ${got.error.message}`);
      continue;
    }
    const out = b({ ...Object.fromEntries([...want.used].map((k) => [k, 1])) });
    if (typeof out !== 'string' || !out.trim()) {
      fail(`[${code}] "${key}" did not return a non-empty string`);
    }
    for (const param of want.used) {
      if (!got.used.has(param)) {
        fail(`[${code}] "${key}" ignores the "${param}" parameter that ${I18N_FALLBACK} uses`);
      }
    }
  }

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(fallbackPack, key)) {
      fail(`[${code}] has key "${key}", which ${I18N_FALLBACK} doesn't — dead entry or typo`);
    }
  }
}

// --- 5) keys referenced from index.html -------------------------------------
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const htmlKeys = new Set();
for (const m of html.matchAll(/\sdata-i18n(?:-html)?="([^"]+)"/g)) htmlKeys.add(m[1]);
for (const m of html.matchAll(/\sdata-i18n-attr="([^"]+)"/g)) {
  for (const pair of m[1].split('|')) {
    const sep = pair.indexOf(':');
    if (sep >= 0) htmlKeys.add(pair.slice(sep + 1).trim());
  }
}
if (htmlKeys.size === 0) fail('index.html references no i18n keys at all — did the markup change?');
for (const key of htmlKeys) {
  if (!Object.prototype.hasOwnProperty.call(fallbackPack, key)) {
    fail(`index.html uses "${key}", which no language pack defines`);
  }
}

// --- 6) literal t('…') keys in js/ ------------------------------------------
// Only static keys can be checked this way. The handful built at runtime are
// listed below instead, so a renamed family still fails here rather than at the
// player's screen.
const DYNAMIC_KEYS = [
  // hint.js: t(`hint.unit.${unitKind}`)
  'hint.unit.region', 'hint.unit.row', 'hint.unit.col',
  // main.js: t(`difficulty.${difficulty}`)
  'difficulty.easy', 'difficulty.medium', 'difficulty.hard',
  // hint.js: t(`hint.crowd.${key}.title` / `.text`)
  'hint.crowd.rowsRegions.title', 'hint.crowd.rowsRegions.text',
  'hint.crowd.colsRegions.title', 'hint.crowd.colsRegions.text',
  'hint.crowd.regionsRows.title', 'hint.crowd.regionsRows.text',
  'hint.crowd.regionsCols.title', 'hint.crowd.regionsCols.text',
];
for (const key of DYNAMIC_KEYS) {
  if (!Object.prototype.hasOwnProperty.call(fallbackPack, key)) {
    fail(`a runtime-built key "${key}" is missing — check DYNAMIC_KEYS in this test`);
  }
}

const jsKeys = new Set();
for (const file of readdirSync(join(ROOT, 'js'))) {
  if (!file.endsWith('.js')) continue;
  const src = readFileSync(join(ROOT, 'js', file), 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-z][\w.]*)'/g)) jsKeys.add(m[1]);
}
for (const key of jsKeys) {
  if (!Object.prototype.hasOwnProperty.call(fallbackPack, key)) {
    fail(`js/ calls t('${key}'), which no language pack defines`);
  }
}

// --- report -----------------------------------------------------------------
if (failed) {
  console.error('verify-i18n.mjs: FAILED');
  process.exit(1);
}
console.log(
  `verify-i18n.mjs: all checks passed ` +
    `(${codes.length} languages × ${fallbackKeys.length} keys, ` +
    `${htmlKeys.size} referenced in index.html, ${jsKeys.size} literal t() keys)`
);
