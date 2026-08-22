// The share dialog shows a *pre-rendered* QR code: index.html carries the SVG
// as plain markup and the app ships no QR generator (see CLAUDE.md → "Sharing").
// That makes the code a piece of data nobody looks at again — and a QR nobody
// can read is invisibly broken, because it still looks like a QR code.
//
// So this guards the two things that can rot:
//   1. the encoder in tools/generate-qr.mjs still produces a *decodable* code
//      (checked by decoding the module matrix back to the URL, independently of
//      how it was encoded),
//   2. the SVG in index.html is still the one that encoder produces for the
//      live address — i.e. the code on screen points where it claims to.
//
// Run: node tests/logic/qr-code.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { qrSvg, qrMatrix, SHARE_URL } from '../../tools/generate-qr.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) failed++;
};

// ---------- 1. the encoder round-trips ----------
// A deliberately independent decoder: it re-reads the finished matrix the way a
// scanner does — undo the mask, lift the format bits, de-interleave the blocks,
// and read the byte segment back out. It shares no code path with the encoder
// beyond the GF(256) tables it doesn't need, so a placement or masking mistake
// shows up here instead of on someone's phone.
const EC_FROM_BITS = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' };
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

function decode(matrix) {
  const size = matrix.length;
  const version = (size - 17) / 4;

  // Format info (top-left copy): 15 bits, unmasked with the standard 0x5412.
  let format = 0;
  const formatBit = (i) => {
    if (i <= 5) return matrix[i][8];
    if (i === 6) return matrix[7][8];
    if (i === 7) return matrix[8][8];
    if (i === 8) return matrix[8][7];
    return matrix[8][14 - i];
  };
  for (let i = 0; i < 15; i++) format |= formatBit(i) << i;
  format ^= 0x5412;
  const ec = EC_FROM_BITS[(format >>> 13) & 3];
  const mask = (format >>> 10) & 7;

  // Which modules carry data: everything the encoder did not reserve. Rebuilt
  // here from the pattern geometry rather than borrowed from the encoder.
  const fixed = Array.from({ length: size }, () => new Uint8Array(size));
  const reserve = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x >= 0 && x < size && y >= 0 && y < size) fixed[y][x] = 1;
      }
    }
  };
  reserve(0, 0, 9, 9);
  reserve(size - 8, 0, 8, 9);
  reserve(0, size - 8, 9, 8);
  for (let i = 0; i < size; i++) {
    fixed[6][i] = 1;
    fixed[i][6] = 1;
  }
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  }[version];
  for (const cy of ALIGN) {
    for (const cx of ALIGN) {
      const nearFinder =
        (cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6);
      if (!nearFinder) reserve(cx - 2, cy - 2, 5, 5);
    }
  }
  if (version >= 7) {
    reserve(size - 11, 0, 3, 6);
    reserve(0, size - 11, 6, 3);
  }

  // Read the zigzag back out, undoing the mask on the way.
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fixed[y][x]) continue;
        bits.push(matrix[y][x] ^ (MASKS[mask](x, y) ? 1 : 0));
      }
    }
  }
  const stream = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    stream.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }

  // De-interleave: data codewords first, column-wise across the blocks.
  const BLOCKS = {
    1: { L: [1, 19], M: [1, 16], Q: [1, 13], H: [1, 9] },
    2: { L: [1, 34], M: [1, 28], Q: [1, 22], H: [1, 16] },
    3: { L: [1, 55], M: [1, 44], Q: [2, 17], H: [2, 13] },
    4: { L: [1, 80], M: [2, 32], Q: [2, 24], H: [4, 9] },
    5: { L: [1, 108], M: [2, 43], Q: [2, 15, 2, 16], H: [2, 11, 2, 12] },
  }[version][ec];
  const lengths = [];
  for (let i = 0; i < BLOCKS.length; i += 2) {
    for (let b = 0; b < BLOCKS[i]; b++) lengths.push(BLOCKS[i + 1]);
  }
  const blocks = lengths.map(() => []);
  let at = 0;
  for (let i = 0; i < Math.max(...lengths); i++) {
    for (let b = 0; b < blocks.length; b++) {
      if (i < lengths[b]) blocks[b].push(stream[at++]);
    }
  }
  const data = blocks.flat();

  // Byte-mode segment: 4-bit mode, 8-bit count (versions < 10), then the bytes.
  let bitAt = 0;
  const take = (n) => {
    let out = 0;
    for (let i = 0; i < n; i++) {
      const byte = data[(bitAt / 8) | 0];
      out = (out << 1) | ((byte >>> (7 - (bitAt % 8))) & 1);
      bitAt++;
    }
    return out;
  };
  if (take(4) !== 0b0100) throw new Error('not a byte-mode segment');
  const len = take(8);
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(take(8));
  return Buffer.from(bytes).toString('utf8');
}

for (const [url, ec] of [
  [SHARE_URL, 'M'],
  [SHARE_URL, 'Q'],
  ['https://example.com/a', 'L'],
  ['https://ilianp.github.io/Queens-clone/?x=1', 'H'],
]) {
  let round = null;
  try {
    round = decode(qrMatrix(url, ec).matrix);
  } catch (err) {
    round = `threw: ${err.message}`;
  }
  check(`encoder round-trips ${ec}: ${url}`, round === url);
}

// ---------- 2. index.html carries that exact code ----------
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const { svg } = qrSvg(SHARE_URL, 'M');
check(
  `index.html embeds the current QR for ${SHARE_URL}`,
  html.includes(svg)
);
// The visible address under the code has to agree with what the code encodes —
// they are two independent strings in the markup.
check(
  'the link next to the code points at the same address',
  html.includes(`href="${SHARE_URL}"`)
);

console.log(failed === 0 ? '\nqr-code: all passed' : `\nqr-code: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
