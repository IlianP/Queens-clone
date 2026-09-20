// Measure the *shape* of Queens boards, so "these levels look different" can be
// argued with numbers instead of vibes.
//
//   node tools/compare-styles.mjs                  # the full table
//   node tools/compare-styles.mjs --size 8         # one size only
//   node tools/compare-styles.mjs --ms 20000       # longer sampling per cell
//   node tools/compare-styles.mjs --styles a,b     # only these styles
//   node tools/compare-styles.mjs --pools          # measure levels/ instead
//   node tools/compare-styles.mjs --erosion        # how much the repair eats
//   node tools/compare-styles.mjs --show 8 hard    # print example boards
//
// Background: screenshots from another Queens app kept showing level looks our
// own generator did not produce. A and B have straighter borders, one big
// "background" colour and a few tiny compact ones — that pair is what 'blocky'
// was built from. C goes further: seven of its eight colours are straight
// one-cell-wide segments around a single 64% background, which is what 'strips'
// was built from. D is the newest and the odd one out — no single background at
// all, but THREE big colours splitting the outer ring between them and small
// ones landlocked in the middle.
//
// The metric suite lives in tools/lib/board-metrics.mjs and is documented in
// docs/board-styles.md, which also carries the reference table this tool
// reproduces. Read that first: the point of this file is to re-measure, not to
// define.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { decodePuzzle } from '../js/levels.js';
import { difficultyLevel, nakedSingleReach } from '../js/solver.js';
import { generatePuzzle, growStyleRaw } from '../js/generator.js';
import {
  boardShape,
  meanShape,
  signatureDistance,
  SIGNATURE_KEYS,
  ascii,
} from './lib/board-metrics.mjs';
import { sampleStyle, playProfile } from './lib/sample.mjs';
import { REFERENCE, shotLike, stripLike, frameLike } from './lib/references.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Shipped styles first, then the experimental ones. docs/board-styles.md says
// which is which and why the second group is not drawn by the game.
export const SHIPPED_STYLES = ['organic', 'blocky', 'strips', 'frame'];
export const EXPERIMENTAL_STYLES = ['quilt', 'voronoi'];
const ALL_STYLES = [...SHIPPED_STYLES, ...EXPERIMENTAL_STYLES];

// Re-exported so the older import sites keep working; the definitions moved to
// lib/ so the regression test can use them without running this CLI.
export { REFERENCE, shotLike, stripLike, frameLike };
export { boardShape, boardShape as boardMetrics, ascii };

const COLS = [
  ['corners', 'Ecken', 5, 1],
  ['bboxFill', 'Füllung', 7, 2],
  ['straight', 'gerade', 6, 2],
  ['maxShare', 'maxAnt', 6, 2],
  ['gini', 'Gini', 5, 2],
  ['ones', '1er', 4, 2],
  ['stripShare', 'Strips', 6, 2],
  ['degree', 'Grad', 5, 2],
  ['edgeBound', 'Rand', 5, 2],
];

const HEAD =
  'Quelle'.padEnd(24) + COLS.map(([, l, w]) => l.padStart(w + 1)).join('') + ' | Signatur';

function shapeRow(label, m, tail = '') {
  return (
    label.padEnd(24) +
    COLS.map(([k, , w, d]) => m[k].toFixed(d).padStart(w + 1)).join('') +
    ' |' +
    tail
  );
}

// For ONE board: which reference looks it has.
function sigTail(m, N) {
  const hits = [shotLike(m) ? 'A/B' : '', stripLike(m, N) ? 'C' : '', frameLike(m) ? 'D' : ''];
  return ' ' + (hits.filter(Boolean).join('+') || '–').padEnd(7);
}

// For a SAMPLE: how often each look actually turns up. A predicate is not
// linear, so running it on the mean board is not the same as asking how many
// boards have the look — and the two genuinely disagree (a style can average
// just outside a threshold while half its boards sit inside it). Rates, always.
function hitTail(shapes, N) {
  const pct = (f) => `${Math.round((100 * shapes.filter(f).length) / shapes.length)}%`;
  return (
    ' ' +
    `${pct((m) => shotLike(m))}/${pct((m) => stripLike(m, N))}/${pct((m) => frameLike(m))}`.padEnd(
      12
    )
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) runCli();

function runCli() {
  const args = process.argv.slice(2);
  const argValue = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const onlySize = argValue('--size') ? Number(argValue('--size')) : null;
  const sampleMs = argValue('--ms') ? Number(argValue('--ms')) : 6000;
  const styles = argValue('--styles') ? argValue('--styles').split(',') : ALL_STYLES;
  const showIdx = args.indexOf('--show');

  if (showIdx >= 0) {
    const N = Number(args[showIdx + 1] || 8);
    const difficulty = args[showIdx + 2] || 'hard';
    for (const style of styles) {
      const p = generatePuzzle(N, difficulty, { style, budgetMs: 4000 });
      const m = boardShape(N, p.region);
      console.log(
        `\n--- ${style} ${N}x${N} ${difficulty} (Rating ${p.level}) | Größen [${m.sizes.join(',')}]` +
          ` | Ecken Ø${m.corners.toFixed(1)} | maxAnt ${(m.maxShare * 100).toFixed(0)}%` +
          ` | Rand ${(m.edgeBound * 100).toFixed(0)}%`
      );
      console.log(ascii(N, p.region));
    }
    return;
  }

  // ---- the four reference screenshots -------------------------------------
  console.log('=== Referenz: die vier Screenshots ===');
  console.log(HEAD);
  const refShapes = {};
  for (const ref of REFERENCE) {
    const m = boardShape(ref.N, ref.region);
    refShapes[ref.name] = { m, N: ref.N };
    const lvl = difficultyLevel(ref.N, ref.region);
    const reach = nakedSingleReach(ref.N, ref.region);
    console.log(
      shapeRow(`${ref.name} (${ref.N}x${ref.N})`, m, sigTail(m, ref.N)) +
        ` [${['easy', 'medium', 'hard', '>hard'][lvl]}, reach ${reach}, Größen ${m.sizes.join(',')}]`
    );
  }

  if (args.includes('--pools')) {
    measurePools();
    return;
  }

  if (args.includes('--erosion')) {
    measureErosion(onlySize !== null ? [onlySize] : [7, 8], styles);
    return;
  }

  // ---- live generation, style by style ------------------------------------
  const SIZES = onlySize !== null ? [onlySize] : [7, 8];
  const fingerprints = {};
  for (const N of SIZES) {
    for (const difficulty of ['easy', 'medium', 'hard']) {
      if (N >= 12 && difficulty !== 'hard') continue;
      console.log(`\n=== ${N}x${N} ${difficulty} — live erzeugt (${sampleMs} ms je Stil) ===`);
      console.log(HEAD.replace('| Signatur', '| A/B/C/D-Quote') + ' ms/Brett  reach  Schritte  Technikmix');
      for (const style of styles) {
        const s = sampleStyle(N, difficulty, style, { ms: sampleMs });
        if (!s.n) {
          console.log(`${`${style}`.padEnd(24)} (kein Brett auf dieser Stufe)`);
          continue;
        }
        fingerprints[`${N}-${difficulty} ${style}`] = s.shape;
        const mix = Object.entries(s.tech)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k.replace('naked-single', 'naked').replace('confinement', 'conf').replace('dead-end', 'dead')} ${(v * 100).toFixed(0)}%`)
          .join(' ');
        console.log(
          shapeRow(style, s.shape, hitTail(s.shapes, N)) +
            ` ${s.msPerBoard.toFixed(0).padStart(8)} ${s.reach.toFixed(1).padStart(6)} ${s.steps.toFixed(0).padStart(9)}  ${mix}  (n=${s.n})`
        );
      }
    }
  }

  // ---- how far apart are they, really? ------------------------------------
  const entries = Object.entries(fingerprints);
  if (entries.length > 1) {
    console.log(
      '\n=== Signaturabstand (Ø normierte Metrikdifferenz; <0.5 gleicher Look, 0.5–1.0 Variante, >1.0 andere Konstruktion) ==='
    );
    const refs = REFERENCE.map((r) => [r.name.replace('Screenshot ', 'Shot '), refShapes[r.name].m]);
    console.log('Stil'.padEnd(24) + refs.map(([n]) => n.padStart(9)).join('') + '  | zum nächsten anderen Stil');
    for (const [label, m] of entries) {
      const dists = refs.map(([, rm]) => signatureDistance(m, rm));
      // Nearest OTHER style in the SAME (size, difficulty) cell. Comparing
      // across cells reads lower than it should — easy and hard boards of the
      // same style already differ — and would flatter every style equally.
      const cell = label.slice(0, label.lastIndexOf(' '));
      let near = null;
      for (const [other, om] of entries) {
        if (!other.startsWith(`${cell} `) || other === label) continue;
        const d = signatureDistance(m, om);
        if (!near || d < near.d) near = { other: other.slice(cell.length + 1), d };
      }
      console.log(
        label.padEnd(24) +
          dists.map((d) => d.toFixed(2).padStart(9)).join('') +
          `  | ${near ? `${near.other} ${near.d.toFixed(2)}` : '–'}`
      );
    }
    console.log(`\n(Metriken der Signatur: ${SIGNATURE_KEYS.join(', ')})`);
  }
}

// The pools on disk are the only sample big enough to answer "how often does an
// EXISTING style produce this look by luck" — which is the question that decides
// whether a screenshot needs a new grower or just a knob. Each mixed entry
// carries its style tag `t`, so the answer can be given per style.
function measurePools() {
  console.log('\n=== ausgelieferte Pools (levels/), nach Stil-Tag ===');
  console.log(HEAD + '   n     A/B-Look   C-Look   D-Look');
  const byTag = {};
  for (let N = 5; N <= 14; N++)
    for (const d of ['easy', 'medium', 'hard']) {
      const f = join(ROOT, 'levels', `${N}-${d}.json`);
      if (!existsSync(f)) continue;
      const pool = JSON.parse(readFileSync(f, 'utf8'));
      for (const e of pool.puzzles) {
        const p = decodePuzzle(N, e);
        const tag = e.t || 'ungetaggt';
        (byTag[tag] ||= []).push({ N, m: boardShape(N, p.region) });
      }
    }
  for (const [tag, rows] of Object.entries(byTag)) {
    const mean = meanShape(rows.map((r) => r.m));
    const pct = (f) => `${((100 * rows.filter(f).length) / rows.length).toFixed(1)}%`.padStart(8);
    console.log(
      shapeRow(tag, mean, '') +
        ` ${String(rows.length).padStart(5)} ${pct((r) => shotLike(r.m))} ${pct((r) => stripLike(r.m, r.N))} ${pct((r) => frameLike(r.m))}`
    );
  }
}

// A style is a CONSTRUCTION plus a REPAIR, and the repair gets the last word.
// `makeUnique` buys uniqueness by moving a cell into an arbitrary neighbouring
// region, which is free to bend a rectangle into an L or a segment into a hook.
// This measures the damage: the same fingerprint before and after, and the
// signature distance between them. A style whose erosion is larger than its
// distance to the styles we already ship cannot deliver its own look — that is
// the finding that sent `strips` off to get `makeUniqueStrips`, and the one
// that disqualified `quilt`.
function measureErosion(sizes, styles, perCell = 120) {
  console.log('\n=== Reparaturverschleiß: Rohwuchs vs. fertiges Brett ===');
  console.log(
    'Stil/Phase'.padEnd(24) +
      COLS.map(([, l, w]) => l.padStart(w + 1)).join('') +
      ' | roh→fertig'
  );
  for (const N of sizes) {
    for (const difficulty of ['medium', 'hard']) {
      console.log(`--- ${N}x${N} ${difficulty} ---`);
      const rawMean = {};
      const finMean = {};
      for (const style of styles) {
        const raw = [];
        for (let i = 0; i < perCell; i++) {
          const g = growStyleRaw(N, difficulty, style);
          if (g) raw.push(boardShape(N, g.region));
        }
        const done = sampleStyle(N, difficulty, style, { ms: 2500, play: false });
        if (!raw.length || !done.n) {
          console.log(`${style.padEnd(24)} (kein Brett)`);
          continue;
        }
        rawMean[style] = meanShape(raw);
        finMean[style] = done.shape;
        console.log(shapeRow(`${style} roh`, rawMean[style], ''));
        console.log(
          shapeRow(`${style} fertig`, finMean[style], '') +
            ` ${signatureDistance(rawMean[style], finMean[style]).toFixed(2)}`
        );
      }
      distinctnessLost(rawMean, finMean);
    }
  }
}

// The reading that actually generalises, and the one the verdicts rest on.
// Erosion alone misfires: `organic` erodes a lot and that is fine, because it
// has no signature to lose. The question is narrower — how much of the
// DISTANCE TO THE SHIPPED STYLES did the construction have before the repair,
// and how much is left after?
//
// It separates the two ways a candidate fails, which erosion lumps together:
// `quilt` starts far away (1.7) and the repair closes ~80% of it, so it needs a
// shape-preserving repair; `voronoi` was never far away to begin with (0.3), so
// no repair would rescue it — the construction simply is not different.
function distinctnessLost(rawMean, finMean) {
  const shipped = SHIPPED_STYLES.filter((o) => finMean[o]);
  console.log(
    '  Eigenständigkeit'.padEnd(26) + 'roh→ausgeliefert  fertig→ausgeliefert  Lücke geschlossen'
  );
  for (const style of Object.keys(finMean)) {
    const others = shipped.filter((o) => o !== style);
    if (!others.length) continue;
    const dRaw = Math.min(...others.map((o) => signatureDistance(rawMean[style], finMean[o])));
    const dFin = Math.min(...others.map((o) => signatureDistance(finMean[style], finMean[o])));
    const closed = dRaw > 0 ? Math.round(100 * (1 - dFin / dRaw)) : 0;
    console.log(
      `  ${style}`.padEnd(26) +
        `${dRaw.toFixed(2).padStart(16)}${dFin.toFixed(2).padStart(21)}${`${closed}%`.padStart(19)}`
    );
  }
}

export { playProfile };
