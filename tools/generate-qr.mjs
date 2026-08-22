#!/usr/bin/env node
// Generates the QR code that the game shows in its share dialog, as a plain
// inline <svg>. This is a DEV tool: the site ships no QR generator, only the
// finished SVG pasted into index.html (see the "QR share" block there).
//
//   node tools/generate-qr.mjs                       # default URL, ECC M
//   node tools/generate-qr.mjs --url https://… -e Q  # anything else
//   node tools/generate-qr.mjs --check               # verify index.html is in sync
//
// Pure Node, no dependencies — a minimal byte-mode QR encoder (versions 1–10,
// which covers any URL this project would ever show). Encoding follows
// ISO/IEC 18004; the module layout is the classic Nayuki formulation with
// (x = column, y = row) throughout, so the placement loops can be compared
// against the reference without re-deriving the coordinates.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const DEFAULT_URL = 'https://ilianp.github.io/Queens-clone/';

// ---------- GF(256) ----------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const buf = new Uint8Array(data.length + ecLen);
  buf.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = buf[i];
    if (!factor) continue;
    for (let j = 0; j < gen.length; j++) buf[i + j] ^= mul(gen[j], factor);
  }
  return Array.from(buf.slice(data.length));
}

// ---------- Block layout (ISO/IEC 18004 table 9), versions 1–10 ----------
// [ecCodewordsPerBlock, [blocks, dataCodewordsPerBlock], …]
const BLOCKS = {
  1: { L: [7, [1, 19]], M: [10, [1, 16]], Q: [13, [1, 13]], H: [17, [1, 9]] },
  2: { L: [10, [1, 34]], M: [16, [1, 28]], Q: [22, [1, 22]], H: [28, [1, 16]] },
  3: { L: [15, [1, 55]], M: [26, [1, 44]], Q: [18, [2, 17]], H: [22, [2, 13]] },
  4: { L: [20, [1, 80]], M: [18, [2, 32]], Q: [26, [2, 24]], H: [16, [4, 9]] },
  5: { L: [26, [1, 108]], M: [24, [2, 43]], Q: [18, [2, 15], [2, 16]], H: [22, [2, 11], [2, 12]] },
  6: { L: [18, [2, 68]], M: [16, [4, 27]], Q: [24, [4, 19]], H: [28, [4, 15]] },
  7: { L: [20, [2, 78]], M: [18, [4, 31]], Q: [18, [2, 14], [4, 15]], H: [26, [4, 13], [1, 14]] },
  8: { L: [24, [2, 97]], M: [22, [2, 38], [2, 39]], Q: [22, [4, 18], [2, 19]], H: [26, [4, 14], [2, 15]] },
  9: { L: [30, [2, 116]], M: [22, [3, 36], [2, 37]], Q: [20, [4, 16], [4, 17]], H: [24, [4, 12], [4, 13]] },
  10: { L: [18, [2, 68], [2, 69]], M: [26, [4, 43], [1, 44]], Q: [24, [6, 19], [2, 20]], H: [28, [6, 15], [2, 16]] },
};
// Alignment pattern centre coordinates per version (empty for version 1).
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };

const groupsOf = (version, ec) => BLOCKS[version][ec].slice(1);
const ecLenOf = (version, ec) => BLOCKS[version][ec][0];
const dataCodewords = (version, ec) =>
  groupsOf(version, ec).reduce((sum, [blocks, len]) => sum + blocks * len, 0);

// ---------- Encoding ----------
function encodeBytes(bytes, ec) {
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const countBits = v < 10 ? 8 : 16;
    if (4 + countBits + 8 * bytes.length <= 8 * dataCodewords(v, ec)) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error(`payload too long for versions 1–10 at ECC ${ec}`);

  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  const capacity = 8 * dataCodewords(version, ec);
  push(0, Math.min(4, capacity - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    words.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  for (let i = 0; words.length < dataCodewords(version, ec); i++) {
    words.push(i % 2 === 0 ? 0xec : 0x11);
  }

  // Split into blocks, add EC, then interleave both halves column-wise.
  const ecLen = ecLenOf(version, ec);
  const dataBlocks = [];
  const ecBlocks = [];
  let at = 0;
  for (const [blocks, len] of groupsOf(version, ec)) {
    for (let b = 0; b < blocks; b++) {
      const block = words.slice(at, at + len);
      at += len;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, ecLen));
    }
  }
  const out = [];
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return { version, codewords: out };
}

// ---------- Module layout ----------
function buildMatrix(version, ec, codewords) {
  const size = version * 4 + 17;
  const grid = Array.from({ length: size }, () => new Uint8Array(size));
  const fixed = Array.from({ length: size }, () => new Uint8Array(size));
  const set = (x, y, dark) => {
    grid[y][x] = dark ? 1 : 0;
    fixed[y][x] = 1;
  };

  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d <= 3); // 7×7 eye plus its separator ring
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  const centres = ALIGN[version];
  for (const cy of centres) {
    for (const cx of centres) {
      const nearFinder =
        (cx === 6 && cy === 6) ||
        (cx === 6 && cy === size - 7) ||
        (cx === size - 7 && cy === 6);
      if (nearFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Reserve the format areas (real bits are written once the mask is chosen).
  for (let i = 0; i < 8; i++) {
    set(8, i, false);
    set(i, 8, false);
    set(8, size - 1 - i, false);
    set(size - 1 - i, 8, false);
  }
  set(8, 8, false);
  set(8, size - 8, true); // the always-dark module

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i) & 1;
      set(size - 11 + (i % 3), Math.floor(i / 3), bit);
      set(Math.floor(i / 3), size - 11 + (i % 3), bit);
    }
  }

  // Zigzag data placement, two columns at a time from the right (skipping the
  // vertical timing column), alternating direction per column pair.
  let bit = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fixed[y][x] || bit >= total) continue;
        grid[y][x] = (codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1;
        bit++;
      }
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = grid.map((row) => Uint8Array.from(row));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!fixed[y][x] && MASKS[mask](x, y)) candidate[y][x] ^= 1;
      }
    }
    placeFormat(candidate, size, ec, mask);
    const score = penalty(candidate, size);
    if (!best || score < best.score) best = { score, mask, matrix: candidate };
  }
  return best.matrix;
}

function placeFormat(matrix, size, ec, mask) {
  const data = (EC_BITS[ec] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const at = (i) => (bits >>> i) & 1;
  for (let i = 0; i <= 5; i++) matrix[i][8] = at(i);
  matrix[7][8] = at(6);
  matrix[8][8] = at(7);
  matrix[8][7] = at(8);
  for (let i = 9; i < 15; i++) matrix[8][14 - i] = at(i);
  for (let i = 0; i < 8; i++) matrix[8][size - 1 - i] = at(i);
  for (let i = 8; i < 15; i++) matrix[size - 15 + i][8] = at(i);
  matrix[size - 8][8] = 1;
}

function penalty(m, size) {
  let score = 0;
  const line = (get) => {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        if (get(a, b) === get(a, b - 1)) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  };
  line((y, x) => m[y][x]);
  line((x, y) => m[y][x]);

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = m[y][x];
      if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
    }
  }

  const FINDERISH = [
    [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
  ];
  const scan = (get) => {
    for (let a = 0; a < size; a++) {
      for (let b = 0; b + 11 <= size; b++) {
        for (const pattern of FINDERISH) {
          let hit = true;
          for (let k = 0; k < 11 && hit; k++) hit = get(a, b + k) === pattern[k];
          if (hit) score += 40;
        }
      }
    }
  };
  scan((y, x) => m[y][x]);
  scan((x, y) => m[y][x]);

  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dark += m[y][x];
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

// ---------- SVG ----------
// One <path> of merged horizontal runs on a light plate. The plate carries the
// 4-module quiet zone the spec requires — a scanner needs it even when the
// dialog behind the code is dark.
function toSvg(matrix, { quiet = 4 } = {}) {
  const size = matrix.length;
  const span = size + quiet * 2;
  const parts = [];
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!matrix[y][x]) {
        x++;
        continue;
      }
      let run = 0;
      while (x + run < size && matrix[y][x + run]) run++;
      parts.push(`M${x + quiet} ${y + quiet}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return [
    `<svg class="qr-svg" viewBox="0 0 ${span} ${span}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true">`,
    `<rect width="${span}" height="${span}" fill="#ffffff"/>`,
    `<path fill="#101426" d="${parts.join('')}"/>`,
    `</svg>`,
  ].join('');
}

export const SHARE_URL = DEFAULT_URL;

export function qrMatrix(text, ec = 'M') {
  const bytes = Array.from(Buffer.from(text, 'utf8'));
  const { version, codewords } = encodeBytes(bytes, ec);
  return { matrix: buildMatrix(version, ec, codewords), version };
}

export function qrSvg(text, ec = 'M') {
  const { matrix, version } = qrMatrix(text, ec);
  return { svg: toSvg(matrix), version };
}

// ---------- CLI ----------
// Guarded so the encoder can also be imported (tests/logic/qr-code.mjs).
const isCli = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isCli) runCli();

function runCli() {
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const url = arg('--url', DEFAULT_URL);
const ec = arg('-e', arg('--ecc', 'M')).toUpperCase();
const { svg, version } = qrSvg(url, ec);

if (argv.includes('--check')) {
  const here = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
  const ok = html.includes(svg);
  console.log(
    ok
      ? `index.html carries the current QR for ${url} (version ${version}-${ec})`
      : `MISMATCH: index.html does not carry the QR for ${url} (version ${version}-${ec})`
  );
  process.exit(ok ? 0 : 1);
}

console.error(`# ${url} → version ${version}-${ec}, ${version * 4 + 17} modules`);
console.log(svg);
}
