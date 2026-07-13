// generator.js
// Produces solvable Queens puzzles with a UNIQUE solution and a target
// difficulty. Strategy:
//   1. Place N non-touching queens (one per row & column) — the intended
//      solution S1.
//   2. Grow N contiguous colour regions outward from each queen (flood fill).
//   3. Repair the board until the puzzle has exactly one solution, by moving a
//      cell that only an alternate solution uses into a neighbouring region.
//   4. Rate the puzzle and prefer one matching the requested difficulty.

import { solveUpTo2, logicSolves, difficultyLevel, nakedSingleReach } from './solver.js';

// Cap for the definitive uniqueness verdict. A board that needs more nodes than
// this to settle is abandoned — we'd only keep it if it were logic-solvable
// (checked first, cheaply), so a slow verdict means "reject" anyway.
const NODE_CAP = 150000;
// Cheap per-iteration cap: enough to instantly find a 2nd solution on a loose
// board, small enough that the repair loop stays fast.
const SMALL_CAP = 40000;

const LEVELS = { easy: 0, medium: 1, hard: 2 };

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// A permutation cols[r] = queen column in row r, where consecutive rows differ
// by >= 2 so no two queens touch (non-adjacent rows are >= 2 apart already).
function generatePlacement(N, rng) {
  const cols = new Array(N).fill(-1);
  const used = new Array(N).fill(false);

  function rec(r) {
    if (r === N) return true;
    const order = shuffle([...Array(N).keys()], rng);
    for (const c of order) {
      if (used[c]) continue;
      if (r > 0 && Math.abs(c - cols[r - 1]) <= 1) continue;
      cols[r] = c;
      used[c] = true;
      if (rec(r + 1)) return true;
      used[c] = false;
      cols[r] = -1;
    }
    return false;
  }

  return rec(0) ? cols : null;
}

// Grow regions from the queen seeds via multi-source flood fill, biased so the
// currently-smallest region grows first. Balanced growth stops a seed from
// being starved into a tiny (size-1) region — a single-cell region is a free
// "only cell of this colour" queen that trivialises the opening (the exact
// complaint that motivated this). Contiguity is guaranteed because a cell is
// only ever claimed when adjacent to its region.
//
// `balance` (0..1) is the fraction of picks that use the smallest-region bias;
// the rest are free/random. It is difficulty-tuned by the caller: easy/medium
// pass 0 (pure random, organic and open — their gentle openings want the tiny
// regions), while hard passes a strong bias to suppress them. Even at a high
// balance a slice of randomness remains, so region shapes stay irregular.
function growRegions(N, cols, rng, balance = 0.85) {
  const region = Array.from({ length: N }, () => new Array(N).fill(-1));
  const size = new Array(N).fill(1); // every region starts as its single seed
  const frontier = [];
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  const addNeighbours = (r, c, reg) => {
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
      if (region[nr][nc] === -1) frontier.push({ r: nr, c: nc, reg });
    }
  };

  for (let i = 0; i < N; i++) {
    region[i][cols[i]] = i;
    addNeighbours(i, cols[i], i);
  }

  let remaining = N * N - N;
  while (remaining > 0 && frontier.length) {
    let k;
    if (rng() >= balance) {
      // Free choice keeps the borders irregular (and, at low balance, lets tiny
      // regions form on purpose for easier boards).
      k = Math.floor(rng() * frontier.length);
    } else {
      // Otherwise expand whichever still-open frontier cell belongs to the
      // smallest region, breaking ties at random. Stale entries (their cell was
      // already claimed) are skipped.
      let bestSize = Infinity;
      for (const f of frontier)
        if (region[f.r][f.c] === -1 && size[f.reg] < bestSize) bestSize = size[f.reg];
      const pick = [];
      for (let i = 0; i < frontier.length; i++) {
        const f = frontier[i];
        if (region[f.r][f.c] === -1 && size[f.reg] <= bestSize) pick.push(i);
      }
      k = pick.length ? pick[Math.floor(rng() * pick.length)] : Math.floor(rng() * frontier.length);
    }
    const f = frontier[k];
    frontier[k] = frontier[frontier.length - 1];
    frontier.pop();
    if (region[f.r][f.c] !== -1) continue;
    region[f.r][f.c] = f.reg;
    size[f.reg]++;
    remaining--;
    addNeighbours(f.r, f.c, f.reg);
  }

  if (remaining > 0) return null; // board is connected, so this shouldn't happen
  return region;
}

function sameSolution(a, b, N) {
  for (let r = 0; r < N; r++) if (a[r] !== b[r]) return false;
  return true;
}

// True if colour region `reg` stays connected after removing cell (ar,ac).
function contiguousWithout(N, region, reg, ar, ac) {
  const cells = [];
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++)
      if (region[r][c] === reg && !(r === ar && c === ac)) cells.push(r * N + c);
  if (cells.length === 0) return false;

  const seen = new Set([cells[0]]);
  const stack = [cells[0]];
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  while (stack.length) {
    const idx = stack.pop();
    const r = (idx / N) | 0;
    const c = idx % N;
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
      if (nr === ar && nc === ac) continue;
      if (region[nr][nc] !== reg) continue;
      const ni = nr * N + nc;
      if (seen.has(ni)) continue;
      seen.add(ni);
      stack.push(ni);
    }
  }
  return seen.size === cells.length;
}

// Mutate `region` until the puzzle is solvable by pure deduction — which makes
// it both UNIQUE and fair (no guessing needed). Each step removes one alternate
// solution S2 by moving an "S2-only" queen cell into a neighbouring region
// (which already contains an S2 queen, so S2 becomes invalid), while the
// intended solution S1 is preserved because we never touch an S1 queen cell.
// Returns true on success, false if it could not converge / stayed unfair.
function makeUnique(N, region, S1, rng, deadline) {
  const maxIters = N * N * 6;
  for (let iter = 0; iter < maxIters; iter++) {
    if (now() > deadline) return false;

    // While the board is still loose it has many solutions, so a cheap bounded
    // search finds a second one almost immediately. Only when it can't (the
    // board looks near-unique) do we pay for the heavier checks below.
    let res = solveUpTo2(N, region, SMALL_CAP);
    if (res.count < 2) {
      // Deduction certificate: a full logic solve proves uniqueness without an
      // exhaustive search.
      if (logicSolves(N, region, 2)) return true;
      // Not logic-solvable by our techniques — settle uniqueness exhaustively.
      res = solveUpTo2(N, region, NODE_CAP);
      if (res.aborted) return false; // too slow to verify — abandon this board
      if (res.count < 2) return true; // unique (difficulty/explainability rated later)
    }
    const S2 = sameSolution(res.first, S1, N) ? res.second : res.first;

    // Cells that are queens in S2 but not in S1.
    const cands = [];
    for (let r = 0; r < N; r++) if (S2[r] !== S1[r]) cands.push(r * N + S2[r]);
    shuffle(cands, rng);

    let moved = false;
    for (const A of cands) {
      const ar = (A / N) | 0;
      const ac = A % N;
      const curReg = region[ar][ac];

      const ngRegs = new Set();
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = ar + dr;
        const nc = ac + dc;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        const rg = region[nr][nc];
        if (rg !== curReg) ngRegs.add(rg);
      }
      if (ngRegs.size === 0) continue;
      if (!contiguousWithout(N, region, curReg, ar, ac)) continue;

      // Any neighbouring region works: S2 has a queen there already, so adding A
      // to it gives that region two S2 queens.
      const ng = [...ngRegs][Math.floor(rng() * ngRegs.size)];
      region[ar][ac] = ng;
      moved = true;
      break;
    }
    if (!moved) return false;
  }
  if (logicSolves(N, region, 2)) return true;
  const res = solveUpTo2(N, region, NODE_CAP);
  return !res.aborted && res.count < 2;
}

/**
 * Generate a puzzle.
 * @param {number} N board size
 * @param {'easy'|'medium'|'hard'} difficulty target difficulty
 * @param {object} [opts] { budgetMs, rng }
 * @returns {{ region:number[][], solution:number[], level:number, attempts:number }}
 */
export function generatePuzzle(N, difficulty, opts = {}) {
  const rng = opts.rng || Math.random;
  const budgetMs = opts.budgetMs ?? 1500;
  const target = LEVELS[difficulty] ?? 1;
  // How many "free" naked-single queens we tolerate for this difficulty before a
  // board counts as too open (it plays easier than its technique rating claims).
  // Easy IS naked singles, so it has no cap; medium allows a handful; hard wants
  // the opening to demand real reasoning, so only a couple of forced queens.
  const reachBudget = target <= 0 ? N : target === 1 ? Math.round(N / 2) : Math.max(1, Math.round(N / 5));
  // Region-growth balancing: ONLY hard suppresses tiny (near-trivial) regions.
  // Any balancing makes boards harder, which starves easy/medium of the low
  // level-0/1 boards they need at large N — and only hard drew the "too many
  // free single-cell regions" complaint. So easy/medium keep the unbiased growth
  // (their openings are meant to be gentle); hard gets a strong bias.
  const balance = target >= 2 ? 0.85 : 0;
  const start = now();

  let best = null; // closest match so far
  let attempts = 0;

  // Score a board: matching the target technique level dominates (×100 so it can
  // never be outweighed), then among equally-rated boards prefer the one with
  // the fewest free naked singles beyond the budget — i.e. the least trivial
  // opening. Level 3 is unexplainable by our hints, so it's penalised heavily.
  const scoreOf = (level, reach) =>
    (Math.abs(level - target) + (level >= 3 ? 100 : 0)) * 100 + Math.max(0, reach - reachBudget);

  while (now() - start < budgetMs) {
    attempts++;
    const cols = generatePlacement(N, rng);
    if (!cols) continue;
    const region = growRegions(N, cols, rng, balance);
    if (!region) continue;
    if (!makeUnique(N, region, cols, rng, start + budgetMs)) continue;

    const level = difficultyLevel(N, region);
    const reach = nakedSingleReach(N, region);
    const result = { region, solution: cols.slice(), level, attempts };
    const dist = scoreOf(level, reach);
    if (best === null || dist < best._dist) {
      best = result;
      best._dist = dist;
    }
    if (dist === 0) {
      delete result._dist;
      return result;
    }
    // A right-level board (dist < 100) with only a couple of extra free queens
    // is accepted once we've spent part of the budget, so large boards — where a
    // perfectly-closed opening is rare — don't always burn the full time. Boards
    // below/above the target level (dist >= 100) never qualify here.
    if (best._dist < 100 && now() - start > budgetMs * 0.5) {
      delete best._dist;
      return best;
    }
  }

  if (best) {
    delete best._dist;
    return best;
  }

  // No unique board within the budget (only happens for the largest sizes on an
  // unlucky run): keep trying with short per-attempt limits so we converge on a
  // unique board quickly, rather than one slow attempt blowing the time.
  // Keep trying until the repair converges. makeUnique is fast and succeeds
  // within a few tries in practice, so we never hand back a non-unique board.
  for (let tries = 0; tries < 500; tries++) {
    attempts++;
    const cols = generatePlacement(N, rng);
    if (!cols) continue;
    const region = growRegions(N, cols, rng, balance);
    if (!region) continue;
    if (!makeUnique(N, region, cols, rng, now() + 500)) continue;
    return { region, solution: cols.slice(), level: difficultyLevel(N, region), attempts };
  }

  // Astronomically-unlikely last resort: a valid board even if uniqueness could
  // not be secured. Kept so the game always has something to render.
  const cols = generatePlacement(N, rng) || defaultPlacement(N);
  const region = growRegions(N, cols, rng, balance) || trivialRegions(N);
  return { region, solution: cols.slice(), level: difficultyLevel(N, region), attempts };
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function defaultPlacement(N) {
  const evens = [];
  const odds = [];
  for (let c = 0; c < N; c++) (c % 2 === 0 ? evens : odds).push(c);
  return evens.concat(odds).slice(0, N);
}

function trivialRegions(N) {
  return Array.from({ length: N }, (_, r) => new Array(N).fill(r));
}
