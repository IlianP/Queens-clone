// solver.js
// Core logic for the Queens puzzle: constraint checking, solution counting
// (for uniqueness) and a human-style deduction solver used to rate difficulty.

// Rules of Queens (LinkedIn game):
//  - N x N board split into N contiguous colour regions.
//  - Place exactly one queen in every row, every column and every region.
//  - No two queens may touch, not even diagonally (king-move adjacency).

/**
 * Build the list of cell indices (r * N + c) for every "unit":
 * each row, each column and each colour region.
 */
export function makeUnits(N, region) {
  const rows = [];
  const cols = [];
  const regions = [];
  for (let i = 0; i < N; i++) {
    rows.push([]);
    cols.push([]);
    regions.push([]);
  }
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const idx = r * N + c;
      rows[r].push(idx);
      cols[c].push(idx);
      regions[region[r][c]].push(idx);
    }
  }
  return { rows, cols, regions };
}

/**
 * Count the number of valid solutions, stopping as soon as `limit` is reached.
 * Because exactly one queen sits in each row we search row by row, which makes
 * the adjacency check trivial (only the previous row's queen can touch us).
 */
export function countSolutions(N, region, limit = 2) {
  const usedCol = new Array(N).fill(false);
  const usedReg = new Array(N).fill(false);
  let count = 0;

  function rec(r, prevCol) {
    if (count >= limit) return;
    if (r === N) {
      count++;
      return;
    }
    for (let c = 0; c < N; c++) {
      if (usedCol[c]) continue;
      if (prevCol >= 0 && Math.abs(c - prevCol) <= 1) continue; // touches queen above
      const reg = region[r][c];
      if (usedReg[reg]) continue;
      usedCol[c] = true;
      usedReg[reg] = true;
      rec(r + 1, c);
      usedCol[c] = false;
      usedReg[reg] = false;
      if (count >= limit) return;
    }
  }

  rec(0, -1);
  return count;
}

/**
 * Search for up to two solutions with a node budget, so a single uniqueness
 * proof can never explode. Returns:
 *   { count, aborted, first, second }
 * where count is capped at 2, `aborted` is true if the node cap was hit before
 * the search finished (so a count < 2 is then inconclusive), and first/second
 * are solutions as cols[r] arrays.
 */
export function solveUpTo2(N, region, maxNodes = Infinity) {
  const usedCol = new Array(N).fill(false);
  const usedReg = new Array(N).fill(false);
  const cur = new Array(N);
  let count = 0;
  let aborted = false;
  let nodes = 0;
  let first = null;
  let second = null;

  function rec(r, prevCol) {
    if (count >= 2 || aborted) return;
    if (++nodes > maxNodes) {
      aborted = true;
      return;
    }
    if (r === N) {
      count++;
      if (count === 1) first = cur.slice();
      else second = cur.slice();
      return;
    }
    for (let c = 0; c < N; c++) {
      if (usedCol[c]) continue;
      if (prevCol >= 0 && Math.abs(c - prevCol) <= 1) continue;
      const reg = region[r][c];
      if (usedReg[reg]) continue;
      usedCol[c] = true;
      usedReg[reg] = true;
      cur[r] = c;
      rec(r + 1, c);
      usedCol[c] = false;
      usedReg[reg] = false;
      if (count >= 2 || aborted) return;
    }
  }

  rec(0, -1);
  return { count, aborted, first, second };
}

/**
 * Enumerate up to `limit` solutions, each returned as an array cols[r] = column
 * of the queen in row r. Searching row by row keeps the adjacency check local.
 */
export function findSolutions(N, region, limit = 2) {
  const usedCol = new Array(N).fill(false);
  const usedReg = new Array(N).fill(false);
  const cur = new Array(N);
  const res = [];

  function rec(r, prevCol) {
    if (res.length >= limit) return;
    if (r === N) {
      res.push(cur.slice());
      return;
    }
    for (let c = 0; c < N; c++) {
      if (usedCol[c]) continue;
      if (prevCol >= 0 && Math.abs(c - prevCol) <= 1) continue;
      const reg = region[r][c];
      if (usedReg[reg]) continue;
      usedCol[c] = true;
      usedReg[reg] = true;
      cur[r] = c;
      rec(r + 1, c);
      usedCol[c] = false;
      usedReg[reg] = false;
      if (res.length >= limit) return;
    }
  }

  rec(0, -1);
  return res;
}

/**
 * Mutable state for the deduction ("human") solver. Cells are candidates until
 * eliminated; placing a queen eliminates its row, column, region and neighbours.
 */
class LogicState {
  constructor(N, region, units) {
    this.N = N;
    this.region = region;
    this.rows = units.rows;
    this.cols = units.cols;
    this.regions = units.regions;
    this.cand = new Uint8Array(N * N).fill(1);
    this.queen = new Uint8Array(N * N);
    this.rowQ = new Uint8Array(N);
    this.colQ = new Uint8Array(N);
    this.regQ = new Uint8Array(N);
    this.queenCount = 0;
    this.invalid = false;
  }

  clone() {
    const s = new LogicState(this.N, this.region, {
      rows: this.rows,
      cols: this.cols,
      regions: this.regions,
    });
    s.cand.set(this.cand);
    s.queen.set(this.queen);
    s.rowQ.set(this.rowQ);
    s.colQ.set(this.colQ);
    s.regQ.set(this.regQ);
    s.queenCount = this.queenCount;
    s.invalid = this.invalid;
    return s;
  }

  placeQueen(idx) {
    const N = this.N;
    const r = (idx / N) | 0;
    const c = idx % N;
    const reg = this.region[r][c];
    if (this.queen[idx]) return;
    if (this.cand[idx] === 0) {
      this.invalid = true;
      return;
    }
    if (this.rowQ[r] || this.colQ[c] || this.regQ[reg]) {
      this.invalid = true;
      return;
    }
    this.queen[idx] = 1;
    this.cand[idx] = 0;
    this.queenCount++;
    this.rowQ[r] = 1;
    this.colQ[c] = 1;
    this.regQ[reg] = 1;

    // Eliminate the rest of the row, column and region.
    for (const i of this.rows[r]) if (i !== idx) this.cand[i] = 0;
    for (const i of this.cols[c]) if (i !== idx) this.cand[i] = 0;
    for (const i of this.regions[reg]) if (i !== idx) this.cand[i] = 0;

    // Eliminate the 8 neighbours (king moves).
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        const ni = nr * N + nc;
        if (this.queen[ni]) {
          this.invalid = true; // two queens touching
          continue;
        }
        this.cand[ni] = 0;
      }
    }
  }

  candidatesOf(cells) {
    const out = [];
    for (const i of cells) if (this.cand[i]) out.push(i);
    return out;
  }

  // Technique 0: naked singles. If a unit that still needs a queen has exactly
  // one candidate cell, that cell must hold the queen.
  applyT0() {
    const N = this.N;
    let changed = false;
    const scan = (unitList, hasQueen) => {
      for (let u = 0; u < N; u++) {
        if (hasQueen[u]) continue;
        const cands = this.candidatesOf(unitList[u]);
        if (cands.length === 0) {
          this.invalid = true;
          return;
        }
        if (cands.length === 1) {
          this.placeQueen(cands[0]);
          changed = true;
          if (this.invalid) return;
        }
      }
    };
    scan(this.rows, this.rowQ);
    if (this.invalid) return changed;
    scan(this.cols, this.colQ);
    if (this.invalid) return changed;
    scan(this.regions, this.regQ);
    return changed;
  }

  eliminate(idx) {
    if (this.queen[idx]) return false;
    if (this.cand[idx]) {
      this.cand[idx] = 0;
      return true;
    }
    return false;
  }

  // Technique 1: line/region intersection ("pointing").
  //  - If every candidate of a region lies in one row (or column), that line's
  //    queen belongs to the region, so clear the rest of that line.
  //  - If every candidate of a row (or column) lies in one region, that
  //    region's queen sits on the line, so clear the region's other cells.
  applyT1() {
    const N = this.N;
    let changed = false;

    for (let reg = 0; reg < N; reg++) {
      if (this.regQ[reg]) continue;
      const cands = this.candidatesOf(this.regions[reg]);
      if (cands.length === 0) {
        this.invalid = true;
        return changed;
      }
      let row = (cands[0] / N) | 0;
      let col = cands[0] % N;
      let sameRow = true;
      let sameCol = true;
      for (const i of cands) {
        if (((i / N) | 0) !== row) sameRow = false;
        if (i % N !== col) sameCol = false;
      }
      if (sameRow) {
        for (const i of this.rows[row]) {
          if (this.region[(i / N) | 0][i % N] !== reg && this.eliminate(i)) changed = true;
        }
      }
      if (sameCol) {
        for (const i of this.cols[col]) {
          if (this.region[(i / N) | 0][i % N] !== reg && this.eliminate(i)) changed = true;
        }
      }
    }

    const lineToRegion = (unitList, hasQueen) => {
      for (let u = 0; u < N; u++) {
        if (hasQueen[u]) continue;
        const cands = this.candidatesOf(unitList[u]);
        if (cands.length === 0) {
          this.invalid = true;
          return;
        }
        const reg0 = this.region[(cands[0] / N) | 0][cands[0] % N];
        let same = true;
        for (const i of cands) {
          if (this.region[(i / N) | 0][i % N] !== reg0) {
            same = false;
            break;
          }
        }
        if (same) {
          for (const i of this.regions[reg0]) {
            if (!unitList[u].includes(i) && this.eliminate(i)) changed = true;
          }
        }
      }
    };
    lineToRegion(this.rows, this.rowQ);
    if (this.invalid) return changed;
    lineToRegion(this.cols, this.colQ);

    return changed;
  }

  // Would a queen on (xr,xc) directly wipe out every remaining cell of some
  // other unit (row / column / region that still needs a queen)? If so that
  // unit could never get its queen, so (xr,xc) is impossible. This is a single,
  // fully explainable step — no hidden multi-step look-ahead.
  _emptiesSomeUnit(xr, xc, xg) {
    const N = this.N;
    const attacks = (r, c) =>
      r === xr ||
      c === xc ||
      this.region[r][c] === xg ||
      (Math.abs(r - xr) <= 1 && Math.abs(c - xc) <= 1);

    for (let r = 0; r < N; r++) {
      if (this.rowQ[r] || r === xr) continue;
      let any = false;
      let all = true;
      for (let c = 0; c < N; c++) {
        if (this.cand[r * N + c]) {
          any = true;
          if (!attacks(r, c)) {
            all = false;
            break;
          }
        }
      }
      if (any && all) return true;
    }
    for (let c = 0; c < N; c++) {
      if (this.colQ[c] || c === xc) continue;
      let any = false;
      let all = true;
      for (let r = 0; r < N; r++) {
        if (this.cand[r * N + c]) {
          any = true;
          if (!attacks(r, c)) {
            all = false;
            break;
          }
        }
      }
      if (any && all) return true;
    }
    for (let g = 0; g < N; g++) {
      if (this.regQ[g] || g === xg) continue;
      let any = false;
      let all = true;
      for (const i of this.regions[g]) {
        if (this.cand[i]) {
          any = true;
          if (!attacks((i / N) | 0, i % N)) {
            all = false;
            break;
          }
        }
      }
      if (any && all) return true;
    }
    return false;
  }

  // Technique 2: direct dead-end. Eliminate any candidate whose queen would
  // empty a whole other unit (see _emptiesSomeUnit). Explainable and visual.
  applyDeadEnd() {
    const N = this.N;
    for (let idx = 0; idx < N * N; idx++) {
      if (!this.cand[idx]) continue;
      const r = (idx / N) | 0;
      const c = idx % N;
      if (this._emptiesSomeUnit(r, c, this.region[r][c])) {
        this.eliminate(idx);
        return true;
      }
    }
    return false;
  }

  // Technique 3: crowding (Hall sets). If the candidates of some k units on one
  // side (say k rows) only ever touch k units on the other side (k regions),
  // those k regions are used up by those k rows — so their cells in any OTHER
  // row can be eliminated. Covers rows<->regions and columns<->regions, in both
  // directions. Explainable: "these k colours only fit in these k rows".
  applyCrowding() {
    const N = this.N;
    const regionOf = (idx) => this.region[(idx / N) | 0][idx % N];
    const rowOf = (idx) => (idx / N) | 0;
    const colOf = (idx) => idx % N;
    return (
      this._hall(this.rows, this.rowQ, rowOf, regionOf) ||
      this._hall(this.cols, this.colQ, colOf, regionOf) ||
      this._hall(this.regions, this.regQ, regionOf, rowOf) ||
      this._hall(this.regions, this.regQ, regionOf, colOf)
    );
  }

  _hall(primCells, primHasQ, primOf, secOf) {
    const N = this.N;
    const CAP = 4;
    const popcount = (x) => {
      let n = 0;
      while (x) {
        x &= x - 1;
        n++;
      }
      return n;
    };
    const masks = new Array(N).fill(0);
    const active = [];
    for (let p = 0; p < N; p++) {
      if (primHasQ[p]) continue;
      let m = 0;
      let any = false;
      for (const idx of primCells[p])
        if (this.cand[idx]) {
          m |= 1 << secOf(idx);
          any = true;
        }
      if (any) {
        masks[p] = m;
        active.push(p);
      }
    }
    const combo = [];
    let changed = false;
    const tryLock = (orMask, size) => {
      if (popcount(orMask) !== size) return false;
      let sMask = 0;
      for (const p of combo) sMask |= 1 << p;
      let did = false;
      for (let idx = 0; idx < N * N; idx++) {
        if (!this.cand[idx]) continue;
        if (((orMask >> secOf(idx)) & 1) && !((sMask >> primOf(idx)) & 1) && this.eliminate(idx))
          did = true;
      }
      return did;
    };
    const rec = (start, orMask) => {
      if (changed) return;
      if (combo.length >= 2 && tryLock(orMask, combo.length)) {
        changed = true;
        return;
      }
      if (combo.length === CAP) return;
      for (let i = start; i < active.length; i++) {
        const nm = orMask | masks[active[i]];
        if (popcount(nm) > CAP) continue;
        combo.push(active[i]);
        rec(i + 1, nm);
        combo.pop();
        if (changed) return;
      }
    };
    rec(0, 0);
    return changed;
  }

  // Run propagation to a fixed point using techniques up to `maxLevel`.
  propagate(maxLevel) {
    while (!this.invalid) {
      if (this.applyT0()) continue;
      if (this.invalid) break;
      if (maxLevel >= 1 && this.applyT1()) continue;
      if (this.invalid) break;
      if (maxLevel >= 2 && this.applyDeadEnd()) continue;
      if (this.invalid) break;
      if (maxLevel >= 2 && this.applyCrowding()) continue;
      break;
    }
  }
}

/**
 * True if the puzzle can be fully solved by pure deduction up to `maxLevel`.
 * A deduction-only solve implies the solution is UNIQUE (deduction never
 * guesses), so this doubles as a fast uniqueness certificate.
 */
export function logicSolves(N, region, maxLevel = 2) {
  const units = makeUnits(N, region);
  const s = new LogicState(N, region, units);
  s.propagate(maxLevel);
  return !s.invalid && s.queenCount === N;
}

/**
 * Rate a puzzle by the simplest deduction level that fully solves it:
 *   0 = easy   (naked singles only)
 *   1 = medium (needs line/region intersections)
 *   2 = hard   (needs depth-1 lookahead)
 *   3 = harder than bounded lookahead (rejected by the generator)
 */
export function difficultyLevel(N, region) {
  const units = makeUnits(N, region);
  for (let lvl = 0; lvl <= 2; lvl++) {
    const s = new LogicState(N, region, units);
    s.propagate(lvl);
    if (!s.invalid && s.queenCount === N) return lvl;
  }
  return 3;
}
