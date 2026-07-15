// levels.js
// Serves puzzles from the precomputed pools in levels/<N>-<difficulty>.json
// (built by tools/generate-levels.mjs) instead of generating live. A stored
// puzzle is randomly rotated/mirrored on every draw — all 8 dihedral (D4)
// symmetries preserve the Queens rules AND the uniqueness of the solution, and
// the colours are shuffled at render time anyway, so one stored shape yields
// many boards a player won't recognise. Region-id permutation would add
// nothing visible (ids never reach the player, only the random colours do).
//
// Constraints (the Artifact bundle concatenates this file into ONE classic
// script, see tools/build-artifact.mjs):
//   - no `import.meta` (SyntaxError in classic scripts) — the pool fetch URL is
//     page-relative instead, which works on GitHub Pages subpaths + localhost;
//   - top-level names must not collide with the other js/ modules;
//   - the bundle injects the pools as `__QUEENS_LEVELS__` (the no-fetch CSP
//     handshake) — keep that global name in sync with build-artifact.mjs.
//
// Pure logic, no DOM. Everything except drawLevel() is synchronous and
// Node-testable; the tools/ scripts reuse encode/decode/transform/canonical.

const LEVEL_POOL_VERSION = 1;

// ---------- encoding ----------
// region -> N*N base-36 chars row-major, solution -> N base-36 chars
// (cols[r] = queen column in row r). N <= 12 so every value fits one char.

export function encodePuzzle(N, region, solution) {
  let r = '';
  for (let row = 0; row < N; row++)
    for (let col = 0; col < N; col++) r += region[row][col].toString(36);
  let s = '';
  for (let row = 0; row < N; row++) s += solution[row].toString(36);
  return { r, s };
}

// Returns { region, solution } or null when the entry is malformed
// (wrong lengths, non-base-36 chars, values out of range).
export function decodePuzzle(N, entry) {
  if (!entry || typeof entry.r !== 'string' || typeof entry.s !== 'string') return null;
  if (entry.r.length !== N * N || entry.s.length !== N) return null;
  const region = [];
  for (let row = 0; row < N; row++) {
    const line = new Array(N);
    for (let col = 0; col < N; col++) {
      const v = parseInt(entry.r[row * N + col], 36);
      if (!(v >= 0 && v < N)) return null;
      line[col] = v;
    }
    region.push(line);
  }
  const solution = new Array(N);
  for (let row = 0; row < N; row++) {
    const v = parseInt(entry.s[row], 36);
    if (!(v >= 0 && v < N)) return null;
    solution[row] = v;
  }
  return { region, solution };
}

// ---------- D4 symmetry transforms ----------
// t = 0 identity | 1 rot 90° cw | 2 rot 180° | 3 rot 270° cw
//     4 transpose | 5 anti-transpose | 6 mirror columns | 7 mirror rows

export function transformCell(N, t, r, c) {
  switch (t) {
    case 1: return [c, N - 1 - r];
    case 2: return [N - 1 - r, N - 1 - c];
    case 3: return [N - 1 - c, r];
    case 4: return [c, r];
    case 5: return [N - 1 - c, N - 1 - r];
    case 6: return [r, N - 1 - c];
    case 7: return [N - 1 - r, c];
    default: return [r, c];
  }
}

// Every transform is a bijection of the grid that maps rows/columns onto
// rows/columns and preserves king-adjacency, so "one queen per row, column and
// region, none touching" — and the uniqueness of the solution — carry over.
// The solution stays representable as cols-per-row because the queen set
// covers all rows and all columns both before and after the transform.
export function transformPuzzle(N, region, solution, t) {
  const outRegion = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const [r2, c2] = transformCell(N, t, r, c);
      outRegion[r2][c2] = region[r][c];
    }
  const outSolution = new Array(N).fill(-1);
  for (let r = 0; r < N; r++) {
    const [r2, c2] = transformCell(N, t, r, solution[r]);
    outSolution[r2] = c2;
  }
  return { region: outRegion, solution: outSolution };
}

// Canonical key for de-duplicating pool entries: region ids are arbitrary
// labels, so normalise both geometry and labels — transform, relabel ids by
// first occurrence in row-major order, serialise; the key is the lexicographic
// minimum over all 8 transforms. Two puzzles are the same shape iff keys match
// (a unique-solution puzzle is fully determined by its region grid).
export function canonicalKey(N, region) {
  let best = null;
  for (let t = 0; t < 8; t++) {
    const grid = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const [r2, c2] = transformCell(N, t, r, c);
        grid[r2][c2] = region[r][c];
      }
    const relabel = new Array(N).fill(-1);
    let next = 0;
    let key = '';
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        const id = grid[r][c];
        if (relabel[id] === -1) relabel[id] = next++;
        key += relabel[id].toString(36);
      }
    if (best === null || key < best) best = key;
  }
  return best;
}

// Cheap O(N²) sanity check: one queen per row (implicit), all columns and all
// regions distinct, no two queens king-adjacent (only consecutive rows can
// touch since there's one queen per row).
export function isValidSolution(N, region, solution) {
  if (!Array.isArray(solution) || solution.length !== N) return false;
  const colSeen = new Array(N).fill(false);
  const regSeen = new Array(N).fill(false);
  for (let r = 0; r < N; r++) {
    const c = solution[r];
    if (!(c >= 0 && c < N) || colSeen[c]) return false;
    colSeen[c] = true;
    const id = region[r][c];
    if (!(id >= 0 && id < N) || regSeen[id]) return false;
    regSeen[id] = true;
    if (r > 0 && Math.abs(c - solution[r - 1]) <= 1) return false;
  }
  return true;
}

// ---------- runtime loader ----------
// The pool fetch promise is cached per bucket so hammering "Neues Spiel" never
// downloads a file twice; a failed load is dropped from the cache so the next
// game simply retries (transient failures self-heal, no negative caching).
// The shuffle bag is deliberately in-memory only: the project persists
// preferences, never game state — repeats across page loads are fine, repeats
// within a session are not.

const levelPoolCache = new Map(); // "N-difficulty" -> Promise<pool|null>
const levelBags = new Map(); // "N-difficulty" -> { size, order, last }

async function loadLevelPool(key, N) {
  try {
    let data;
    const embedded = typeof globalThis !== 'undefined' && globalThis.__QUEENS_LEVELS__;
    if (embedded) {
      data = embedded[key];
    } else {
      const res = await fetch(`./levels/${key}.json`);
      if (!res.ok) return null;
      data = await res.json();
    }
    if (
      !data ||
      data.v !== LEVEL_POOL_VERSION ||
      data.n !== N ||
      typeof data.level !== 'number' ||
      !Array.isArray(data.puzzles) ||
      data.puzzles.length === 0
    )
      return null;
    return data;
  } catch (e) {
    return null;
  }
}

// Session shuffle-bag: serve every pool entry once in random order before any
// repeats, and never serve the same shape twice in a row across refills.
function drawLevelIndex(key, size) {
  let bag = levelBags.get(key);
  if (!bag || bag.size !== size) {
    bag = { size, order: [], last: -1 };
    levelBags.set(key, bag);
  }
  if (bag.order.length === 0) {
    const order = Array.from({ length: size }, (_, i) => i);
    for (let i = size - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    // next draw pops from the end — dodge an immediate repeat across refills
    if (size > 1 && order[size - 1] === bag.last) {
      [order[size - 1], order[0]] = [order[0], order[size - 1]];
    }
    bag.order = order;
  }
  const idx = bag.order.pop();
  bag.last = idx;
  return idx;
}

/**
 * Draw a random, randomly-transformed puzzle from the precomputed pool.
 * Never throws; resolves null on any failure (missing/invalid pool, bad
 * entry) so the caller can fall back to live generation.
 * @returns {Promise<{region:number[][], solution:number[], level:number}|null>}
 */
export async function drawLevel(N, difficulty) {
  try {
    const key = `${N}-${difficulty}`;
    let poolPromise = levelPoolCache.get(key);
    if (!poolPromise) {
      poolPromise = loadLevelPool(key, N);
      levelPoolCache.set(key, poolPromise);
    }
    const pool = await poolPromise;
    if (!pool) {
      levelPoolCache.delete(key); // retry on the next game
      return null;
    }
    const entry = pool.puzzles[drawLevelIndex(key, pool.puzzles.length)];
    const decoded = decodePuzzle(N, entry);
    if (!decoded || !isValidSolution(N, decoded.region, decoded.solution)) return null;
    const t = Math.floor(Math.random() * 8);
    const { region, solution } = transformPuzzle(N, decoded.region, decoded.solution, t);
    return { region, solution, level: pool.level };
  } catch (e) {
    return null;
  }
}
