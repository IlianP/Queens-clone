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

// The four orthogonal steps, shared by the strips grower and its repair. The two
// older growers keep their own local copies; they are not part of this change.
const ORTHO = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

// Size floor for a strip. Same reasoning as blocky's `minSize`: a one-cell
// region is a free "only cell of this colour" queen. Unlike blocky this floor
// costs nothing on easy, because the strips style has no easy boards to lose
// (see `stripCoverage`).
const STRIP_MIN_LEN = 2;

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

// Alternative region growth: the "blocky" style (see CLAUDE.md → "Level-Stile").
// Instead of claiming ONE cell per step it annexes a straight SEGMENT — a run of
// up to `maxRun` free cells in one direction — which is what produces the long
// straight borders and rectangle-ish regions of a hand-designed-looking board.
//
// The other two knobs replace what `balance` does in growRegions:
//   - `minSize` is a floor, not an equaliser. Regions under the floor grow first
//     (smallest wins), so no region is starved into a free "only cell of this
//     colour" queen — but once the floor is met, sizes are free to diverge, so
//     small 2-3 cell regions and one big background region can coexist.
//   - `dominance` is the chance that a free step goes to one designated region,
//     which is how that big background region forms on purpose rather than by
//     luck. growRegions can only get there via preferential attachment, and its
//     smallest-first bias actively fights it. `maxShare` caps it: once the
//     background covers that fraction of the board the bias switches off, so a
//     lucky run can't swallow the board and squeeze every other colour flat.
function growRegionsBlocky(
  N,
  cols,
  rng,
  { minSize = 2, maxRun = 6, dominance = 0.45, maxShare = 0.4 } = {}
) {
  const region = Array.from({ length: N }, () => new Array(N).fill(-1));
  const size = new Array(N).fill(1); // every region starts as its single seed
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (let i = 0; i < N; i++) region[i][cols[i]] = i;
  let remaining = N * N - N;
  const background = Math.floor(rng() * N);
  const free = (r, c) => r >= 0 && r < N && c >= 0 && c < N && region[r][c] === -1;

  // Every (free cell, adjacent region) pair. Recomputed per step: N is <= 12, so
  // this stays trivial next to the uniqueness search that follows.
  const frontier = () => {
    const out = [];
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) {
        if (region[r][c] !== -1) continue;
        const seen = new Set();
        for (const [dr, dc] of dirs) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
          if (region[nr][nc] !== -1) seen.add(region[nr][nc]);
        }
        for (const g of seen) out.push([r, c, g]);
      }
    return out;
  };

  // Claim a straight run starting at (r,c). It stops at the first non-free cell,
  // so contiguity holds: the first cell touches the region, each later one
  // touches its predecessor.
  const annex = (r, c, g) => {
    const [dr, dc] = dirs[Math.floor(rng() * 4)];
    const len = 1 + Math.floor(rng() * maxRun);
    for (let k = 0; k < len; k++) {
      const rr = r + dr * k;
      const cc = c + dc * k;
      if (!free(rr, cc)) break;
      region[rr][cc] = g;
      size[g]++;
      remaining--;
    }
  };

  let guard = N * N * 8; // every iteration claims >= 1 cell, so this never bites
  while (remaining > 0 && guard-- > 0) {
    const f = frontier();
    if (!f.length) break;
    const hungry = f.filter(([, , g]) => size[g] < minSize);
    let pick;
    if (hungry.length) {
      let smallest = Infinity;
      for (const [, , g] of hungry) smallest = Math.min(smallest, size[g]);
      const pool = hungry.filter(([, , g]) => size[g] === smallest);
      pick = pool[Math.floor(rng() * pool.length)];
    } else if (size[background] < maxShare * N * N && rng() < dominance) {
      const pool = f.filter(([, , g]) => g === background);
      pick = pool.length ? pool[Math.floor(rng() * pool.length)] : f[Math.floor(rng() * f.length)];
    } else {
      pick = f[Math.floor(rng() * f.length)];
    }
    annex(pick[0], pick[1], pick[2]);
  }

  if (remaining > 0) return null; // board is connected, so this shouldn't happen
  return region;
}

// Third region growth: the "strips" style (see CLAUDE.md → "Region-growth
// styles"). It comes from a LinkedIn screenshot whose signature neither of the
// two styles above reproduces: on that 8x8 board SEVEN of the eight colours were
// straight, one-cell-wide segments (a 1x2 up to a 1x5), and the eighth was one
// amorphous background covering 64% of the grid. Measured over the 1760 shipped
// pool boards, "N-1 regions are strips" occurs in 0.15% of blocky boards and in
// none at all of the organic ones — it is not a rare draw of the other styles,
// it is a different construction.
//
// So this grower builds it directly instead of hoping for it: every queen but
// one gets a straight segment through its own cell, and whatever is left over
// becomes the one background region. That flips the usual job — the other two
// styles decide where borders run, this one decides how much board is NOT a
// border.
//
// The invariant that makes it work: the background is "every cell no strip
// claimed", so it is contiguous exactly when the still-free cells plus the
// background's own seed stay connected. Checking that after every single claim
// turns "grow a board, then test it, then throw it away" into a local veto, and
// the build succeeds essentially always instead of ~10% of the time.
//
// Knobs:
//   - `minLen` (2) is a floor like blocky's: a 1-cell region is a free queen.
//   - `coverage` is the share of the board the strips should claim between them;
//     the rest is background. The screenshot sits at 36% strips / 64% background.
//     The caller tapers it with N (see `stripCoverage`).
//   - `spread` varies the individual strip caps around that mean, so lengths
//     come out mixed (the screenshot's were 2,2,3,3,4,4,5) rather than uniform.
function growRegionsStrips(N, cols, rng, { minLen = 2, coverage = 0.5, spread = 0.6 } = {}) {
  const region = Array.from({ length: N }, () => new Array(N).fill(-1));
  for (let i = 0; i < N; i++) region[i][cols[i]] = i;
  const background = Math.floor(rng() * N);
  const bgSeedR = background;
  const bgSeedC = cols[background];

  // Connectivity of the future background: the free cells plus its seed.
  const freeMassConnected = () => {
    const inMass = (r, c) => region[r][c] === -1 || (r === bgSeedR && c === bgSeedC);
    let startR = -1;
    let startC = -1;
    let total = 0;
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        if (inMass(r, c)) {
          total++;
          if (startR < 0) {
            startR = r;
            startC = c;
          }
        }
    if (startR < 0) return false;
    const seen = new Set([startR * N + startC]);
    const stack = [[startR, startC]];
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [dr, dc] of ORTHO) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N || !inMass(nr, nc)) continue;
        const ni = nr * N + nc;
        if (seen.has(ni)) continue;
        seen.add(ni);
        stack.push([nr, nc]);
      }
    }
    return seen.size === total;
  };

  const meanLen = (coverage * N * N) / (N - 1);
  const strips = [];
  for (let g = 0; g < N; g++) {
    if (g === background) continue;
    strips.push({
      g,
      r: g,
      c: cols[g],
      vertical: rng() < 0.5,
      flipped: false,
      lo: 0,
      hi: 0,
      len: 1,
      cap: Math.max(minLen, Math.round(meanLen + (rng() * 2 - 1) * spread * meanLen)),
    });
  }

  // Claim the cell `off` steps from the seed along the strip's axis, unless it
  // would cut the background in two.
  const claim = (s, off) => {
    const r = s.vertical ? s.r + off : s.r;
    const c = s.vertical ? s.c : s.c + off;
    if (r < 0 || r >= N || c < 0 || c >= N || region[r][c] !== -1) return false;
    region[r][c] = s.g;
    if (!freeMassConnected()) {
      region[r][c] = -1;
      return false;
    }
    s.len++;
    if (off > s.hi) s.hi = off;
    else s.lo = off;
    return true;
  };
  const extend = (s) => {
    const sides = rng() < 0.5 ? [s.hi + 1, s.lo - 1] : [s.lo - 1, s.hi + 1];
    for (const off of sides) if (claim(s, off)) return true;
    return false;
  };

  // Phase 1: every strip must reach the floor. A seed boxed in along its first
  // axis gets one flip of orientation; only then is the board scrapped.
  for (const s of strips) {
    while (s.len < minLen) {
      if (extend(s)) continue;
      if (s.len === 1 && !s.flipped) {
        s.flipped = true;
        s.vertical = !s.vertical;
        continue;
      }
      return null;
    }
  }
  // Phase 2: round-robin to the individual caps, so an early strip can't eat the
  // room the later ones need.
  let live = strips.filter((s) => s.len < s.cap);
  while (live.length) {
    let any = false;
    for (const s of shuffle(live, rng)) if (s.len < s.cap && extend(s)) any = true;
    if (!any) break;
    live = live.filter((s) => s.len < s.cap);
  }

  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) if (region[r][c] === -1) region[r][c] = background;
  return { region, background };
}

// Uniqueness repair for the strips style. `makeUnique` above can't be used: it
// moves a cell into an arbitrary neighbouring region, which turns a straight
// segment into an L and destroys the very thing this style is built for.
//
// It kills an alternate solution S2 the same way — every solution holds exactly
// one queen per region, so giving a region a SECOND S2 queen invalidates S2 —
// but only through two moves that leave every strip a strip:
//   - GROW: a background cell that continues some strip's line joins that strip.
//     Tried first: it makes the board tighter, which is the direction uniqueness
//     lies in.
//   - SHRINK: a strip's end cell goes to the background. Always available where
//     grow isn't, and shortening a segment from an end leaves a segment.
// Neither ever touches an S1 queen cell, so the intended solution survives; the
// size floor and both contiguity invariants are re-checked per move.
function makeUniqueStrips(N, region, S1, background, rng, deadline) {
  const maxIters = N * N * 6;
  const sizeOf = (g) => {
    let n = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (region[r][c] === g) n++;
    return n;
  };
  const sameRegionNeighbours = (r, c, g) => {
    let n = 0;
    for (const [dr, dc] of ORTHO) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < N && nc >= 0 && nc < N && region[nr][nc] === g) n++;
    }
    return n;
  };
  const touches = (r, c, g) => sameRegionNeighbours(r, c, g) > 0;
  // A 1-wide segment stays one iff the bounding box is a line the cells fill.
  const isStrip = (g) => {
    let r0 = N;
    let r1 = -1;
    let c0 = N;
    let c1 = -1;
    let area = 0;
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++)
        if (region[r][c] === g) {
          area++;
          if (r < r0) r0 = r;
          if (r > r1) r1 = r;
          if (c < c0) c0 = c;
          if (c > c1) c1 = c;
        }
    const h = r1 - r0 + 1;
    const w = c1 - c0 + 1;
    return (h === 1 || w === 1) && area === Math.max(h, w);
  };

  for (let iter = 0; iter < maxIters; iter++) {
    if (now() > deadline) return false;

    let res = solveUpTo2(N, region, SMALL_CAP);
    if (res.count < 2) {
      if (logicSolves(N, region, 2)) return true;
      res = solveUpTo2(N, region, NODE_CAP);
      if (res.aborted) return false;
      if (res.count < 2) return true;
    }
    const S2 = sameSolution(res.first, S1, N) ? res.second : res.first;

    const cands = [];
    for (let r = 0; r < N; r++) if (S2[r] !== S1[r]) cands.push([r, S2[r]]);
    shuffle(cands, rng);

    let moved = false;
    for (const [ar, ac] of cands) {
      if (region[ar][ac] !== background) continue;
      const targets = [];
      for (const [dr, dc] of ORTHO) {
        const nr = ar + dr;
        const nc = ac + dc;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        const g = region[nr][nc];
        if (g !== background && !targets.includes(g)) targets.push(g);
      }
      for (const g of shuffle(targets, rng)) {
        region[ar][ac] = g;
        if (isStrip(g) && regionContiguous(N, region, background)) {
          moved = true;
          break;
        }
        region[ar][ac] = background;
      }
      if (moved) break;
    }
    if (!moved) {
      for (const [ar, ac] of cands) {
        const g = region[ar][ac];
        if (g === background) continue;
        if (sizeOf(g) <= STRIP_MIN_LEN) continue; // never shrink below the floor
        if (sameRegionNeighbours(ar, ac, g) > 1) continue; // a middle cell would split it
        if (!touches(ar, ac, background)) continue; // background must stay contiguous
        region[ar][ac] = background;
        moved = true;
        break;
      }
    }
    if (!moved) return false;
  }
  if (logicSolves(N, region, 2)) return true;
  const res = solveUpTo2(N, region, NODE_CAP);
  return !res.aborted && res.count < 2;
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

// Is colour region `reg` contiguous as it stands? contiguousWithout with a cell
// coordinate no board has, so nothing is removed.
function regionContiguous(N, region, reg) {
  return contiguousWithout(N, region, reg, -1, -1);
}

// Mutate `region` until the puzzle is solvable by pure deduction — which makes
// it both UNIQUE and fair (no guessing needed). Each step removes one alternate
// solution S2 by moving an "S2-only" queen cell into a neighbouring region
// (which already contains an S2 queen, so S2 becomes invalid), while the
// intended solution S1 is preserved because we never touch an S1 queen cell.
// Returns true on success, false if it could not converge / stayed unfair.
//
// `minSize` (default 1 = no floor, the historic behaviour) keeps the repair from
// undoing a growth floor: every move takes a cell AWAY from its region, so
// without this a region grown to exactly `minSize` can still be whittled down to
// a single free cell here — the very thing the floor exists to prevent.
function makeUnique(N, region, S1, rng, deadline, minSize = 1) {
  const maxIters = N * N * 6;
  const sizeOf = (g) => {
    let n = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (region[r][c] === g) n++;
    return n;
  };
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
      if (minSize > 1 && sizeOf(curReg) <= minSize) continue;

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

// Per-difficulty knobs for the blocky style. `minSize` is the one that matters:
// a floor of 2 removes every free single-cell region, which is exactly what an
// EASY board needs to keep (its whole technique is the naked single, so it needs
// a forced opening) — measured, a floor of 2 drops the easy yield to ~0%. So easy
// keeps the floor at 1 and gets only the straight-border look, while medium/hard
// get the full screenshot signature: no freebies, one big background region.
// Easy also gets a milder dominance: with no floor its small regions stay small,
// so the same bias that lands medium/hard at the screenshots' ~35% background
// runs away to ~50% there and leaves a board of one blob plus freebies.
const BLOCKY_OPTS = {
  0: { minSize: 1, maxRun: 6, dominance: 0.2, maxShare: 0.32 },
  1: { minSize: 2, maxRun: 6, dominance: 0.45, maxShare: 0.4 },
  2: { minSize: 2, maxRun: 6, dominance: 0.45, maxShare: 0.4 },
};

// How much of the board the strips claim between them, by size. The screenshot
// this style comes from sits at 36% strips / 64% background on an 8x8, and a
// small board reproduces that comfortably. A big one cannot: strips get in each
// other's way, so the background share drifts up regardless, and asking for more
// coverage only makes the uniqueness repair grind (measured on 12x12: 40 ms per
// hard board at 0.40, 507 ms at 0.50). So the ask tapers and the look holds —
// one dominant background with N-1 straight segments in it — rather than the
// exact 64%.
function stripCoverage(N) {
  return N <= 9 ? 0.55 : Math.max(0.36, 0.55 - 0.05 * (N - 9));
}

/**
 * Generate a puzzle.
 * @param {number} N board size
 * @param {'easy'|'medium'|'hard'} difficulty target difficulty
 * @param {object} [opts] { budgetMs, rng, style }
 *   style: 'organic' (default — flood fill, the shape the shipped pools have)
 *          | 'blocky' (segment growth: straight borders, one big background
 *            region, no single-cell freebies above easy)
 *          | 'strips' (N-1 straight one-wide segments plus one background
 *            region — has NO easy boards, see below)
 * @returns {{ region:number[][], solution:number[], level:number, attempts:number }}
 */
export function generatePuzzle(N, difficulty, opts = {}) {
  const rng = opts.rng || Math.random;
  const budgetMs = opts.budgetMs ?? 1500;
  const target = LEVELS[difficulty] ?? 1;
  const blocky = opts.style === 'blocky';
  // The strips style has no EASY boards at all — with a size floor of 2 no
  // colour is ever down to its last cell at the start, so the opening is always
  // a line<->region confinement (medium) and the naked-single reach is 0. Across
  // ~60k sampled boards at every size not one rated easy. That is a property of
  // the construction, not a tuning miss: raising the floor is what creates the
  // look, and dropping it to 1 would just rebuild blocky-easy under a new name.
  // So callers ask for strips on medium/hard only (see tools/generate-levels.mjs
  // and randomStyle() in main.js); asking for easy is not an error, it simply
  // comes back one level up, honestly rated.
  const strips = opts.style === 'strips';
  const blockyOpts = BLOCKY_OPTS[target] ?? BLOCKY_OPTS[1];
  const minSize = blocky ? blockyOpts.minSize : strips ? STRIP_MIN_LEN : 1;
  const stripsOpts = { minLen: STRIP_MIN_LEN, coverage: stripCoverage(N), spread: 0.6 };
  // Growth returns the region grid plus, for strips, which id ended up as the
  // background — the repair below needs it, and only that grower decides it.
  const grow = (cols, balanceIn) => {
    if (strips) return growRegionsStrips(N, cols, rng, stripsOpts);
    const region = blocky
      ? growRegionsBlocky(N, cols, rng, blockyOpts)
      : growRegions(N, cols, rng, balanceIn);
    return region ? { region, background: -1 } : null;
  };
  const repair = (grown, cols, deadline) =>
    strips
      ? makeUniqueStrips(N, grown.region, cols, grown.background, rng, deadline)
      : makeUnique(N, grown.region, cols, rng, deadline, minSize);
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
  // opening. Level-3 boards never reach here — they're rejected outright below.
  const scoreOf = (level, reach) =>
    Math.abs(level - target) * 100 + Math.max(0, reach - reachBudget);

  while (now() - start < budgetMs) {
    attempts++;
    const cols = generatePlacement(N, rng);
    if (!cols) continue;
    const grown = grow(cols, balance);
    if (!grown) continue;
    const region = grown.region;
    if (!repair(grown, cols, start + budgetMs)) continue;

    const level = difficultyLevel(N, region);
    // A level-3 board isn't solvable by our explainable techniques, so every
    // hint on it degrades to the honest "reveal" fallback ("Hier gehört die
    // nächste Dame hin.") — useless to the player. Never return one: skip it so
    // `best` only ever holds a fair (logic-solvable) board.
    if (level >= 3) continue;
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

  // The budget expired without a single fair board at the target difficulty
  // (happens for the largest sizes on an unlucky run — most often HARD, whose
  // biased region growth makes fair boards rare). Fairness — solvability by the
  // guaranteed technique ladder — is the core invariant: a board whose hints
  // degrade to the unexplained "reveal" fallback is worse than one a notch
  // easier than requested. So we keep searching, but now optimise for fairness
  // over difficulty and NEVER hand back a level-3 board.
  //
  // Crucially we switch to organic growth (balance 0) here: the smallest-region
  // bias is exactly what starves fair boards, so dropping it makes a fair,
  // logic-solvable board appear within a few tries even at large N (verified),
  // which also avoids the slow pile-up of level-3 verifications that made this
  // path drag on. Keep the fair board closest to the requested difficulty.
  let fair = null; // closest-difficulty fair board so far
  const fallbackDeadline = now() + Math.max(1500, budgetMs);
  for (let tries = 0; tries < 1000 && now() < fallbackDeadline; tries++) {
    attempts++;
    const cols = generatePlacement(N, rng);
    if (!cols) continue;
    const grown = grow(cols, 0);
    if (!grown) continue;
    const region = grown.region;
    if (!repair(grown, cols, now() + 500)) continue;
    const level = difficultyLevel(N, region);
    if (level >= 3) continue; // never hand back a board the hints can't explain
    const dist = Math.abs(level - target);
    if (fair === null || dist < fair._dist) {
      fair = { region, solution: cols.slice(), level, attempts };
      fair._dist = dist;
    }
    if (dist === 0) break; // exact difficulty match — done
  }
  if (fair) {
    delete fair._dist;
    return fair;
  }

  // Astronomically-unlikely last resort (organic growth yielded no fair unique
  // board at all above): keep generating organic unique boards and return the
  // first fair one, so the contract "solvable by pure logic" holds. Organic
  // boards are fair with overwhelming probability, so this returns almost
  // immediately; the last unique board is kept only so the game can always
  // render something if every single attempt somehow failed the fairness check.
  let lastUnique = null;
  for (let tries = 0; tries < 2000; tries++) {
    attempts++;
    const cols = generatePlacement(N, rng) || defaultPlacement(N);
    // Organic explicitly, not the requested style: this path's only job is to
    // hand back SOME fair unique board, and organic is the growth whose repair
    // never fails. (It also keeps the strips style away from `makeUnique`, which
    // would happily bend a segment into an L to buy uniqueness.)
    const region = growRegions(N, cols, rng, 0) || trivialRegions(N);
    // No size floor here on purpose, for the same reason: the floor can only
    // make the repair fail.
    if (!makeUnique(N, region, cols, rng, now() + 500)) continue;
    const level = difficultyLevel(N, region);
    const result = { region, solution: cols.slice(), level, attempts };
    if (level <= 2) return result; // fair AND unique
    lastUnique = result;
  }
  return lastUnique || { region: trivialRegions(N), solution: defaultPlacement(N), level: 0, attempts };
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
