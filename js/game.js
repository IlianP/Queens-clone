// game.js
// Interactive game state: player marks, queens, quick-mode auto-marks,
// conflict detection and win checking. Pure logic, no DOM.

export class Game {
  constructor(N, region, quickMode) {
    this.N = N;
    this.region = region; // region[r][c] -> region id
    this.quickMode = quickMode;
    this.queen = grid(N, false);
    this.mark = grid(N, false); // manual "X" marks placed by the player
    this.queenCount = 0;
  }

  setQuickMode(q) {
    this.quickMode = q;
  }

  reset() {
    this.queen = grid(this.N, false);
    this.mark = grid(this.N, false);
    this.queenCount = 0;
  }

  // Cycle a cell: empty -> dot (mark) -> queen -> empty.
  // In quick mode an auto-dotted (but unmarked) cell jumps straight to a queen,
  // so you don't have to tap past the dot.
  tap(r, c) {
    if (this.queen[r][c]) {
      this.queen[r][c] = false;
      this.queenCount--;
    } else if (this.mark[r][c] || this._autoMarked(r, c)) {
      this.mark[r][c] = false;
      this.queen[r][c] = true;
      this.queenCount++;
    } else {
      this.mark[r][c] = true;
    }
  }

  // Whether (r,c) is auto-dotted by quick mode because a queen already rules it
  // out: same row, column or region, or an adjacent (touching) cell.
  _autoMarked(r, c) {
    if (!this.quickMode) return false;
    if (this.queen[r][c]) return false;
    const N = this.N;
    const reg = this.region[r][c];
    for (let qr = 0; qr < N; qr++) {
      for (let qc = 0; qc < N; qc++) {
        if (!this.queen[qr][qc]) continue;
        if (qr === r || qc === c) return true;
        if (this.region[qr][qc] === reg) return true;
        if (Math.abs(qr - r) <= 1 && Math.abs(qc - c) <= 1) return true;
      }
    }
    return false;
  }

  // Full board of auto-mark flags (computed once per render for efficiency).
  autoMarkGrid() {
    const N = this.N;
    const auto = grid(N, false);
    if (!this.quickMode) return auto;
    for (let qr = 0; qr < N; qr++) {
      for (let qc = 0; qc < N; qc++) {
        if (!this.queen[qr][qc]) continue;
        const reg = this.region[qr][qc];
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            if (this.queen[r][c]) continue;
            if (
              qr === r ||
              qc === c ||
              this.region[r][c] === reg ||
              (Math.abs(qr - r) <= 1 && Math.abs(qc - c) <= 1)
            ) {
              auto[r][c] = true;
            }
          }
        }
      }
    }
    return auto;
  }

  // Set of "r,c" strings for queens that violate a rule (share a row, column or
  // region with another queen, or touch one). Used to highlight mistakes.
  conflicts() {
    const N = this.N;
    const qs = [];
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) if (this.queen[r][c]) qs.push([r, c]);

    const bad = new Set();
    for (let i = 0; i < qs.length; i++) {
      for (let j = i + 1; j < qs.length; j++) {
        const [r1, c1] = qs[i];
        const [r2, c2] = qs[j];
        const touching = Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
        if (
          r1 === r2 ||
          c1 === c2 ||
          this.region[r1][c1] === this.region[r2][c2] ||
          touching
        ) {
          bad.add(`${r1},${c1}`);
          bad.add(`${r2},${c2}`);
        }
      }
    }
    return bad;
  }

  // Units (colour regions, rows and columns) that can no longer receive a
  // queen: they hold no queen and every one of their cells is already dotted (a
  // manual mark or a quick-mode auto-mark). Such a unit is a dead end — the
  // puzzle can't be finished while it stays this way — so the UI outlines it in
  // red, mirroring how impossible queens are flagged. A queen belongs to exactly
  // one row, column and region, so the same "no queen + nothing open" test
  // applies to all three unit kinds.
  deadUnits(auto = this.autoMarkGrid()) {
    const N = this.N;
    const regQueen = new Set();
    const regOpen = new Set(); // units that still have a placeable cell
    const allReg = new Set();
    const rowQueen = new Array(N).fill(false);
    const rowOpen = new Array(N).fill(false);
    const colQueen = new Array(N).fill(false);
    const colOpen = new Array(N).fill(false);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const reg = this.region[r][c];
        allReg.add(reg);
        if (this.queen[r][c]) {
          regQueen.add(reg);
          rowQueen[r] = colQueen[c] = true;
        } else if (!this.mark[r][c] && !auto[r][c]) {
          regOpen.add(reg);
          rowOpen[r] = colOpen[c] = true;
        }
      }
    }
    const regions = new Set();
    for (const reg of allReg) if (!regQueen.has(reg) && !regOpen.has(reg)) regions.add(reg);
    const rows = new Set();
    const cols = new Set();
    for (let i = 0; i < N; i++) {
      if (!rowQueen[i] && !rowOpen[i]) rows.add(i);
      if (!colQueen[i] && !colOpen[i]) cols.add(i);
    }
    return { regions, rows, cols };
  }

  isWon() {
    return this.queenCount === this.N && this.conflicts().size === 0;
  }

  // Easter-egg check: the player has dotted every single cell and placed no
  // queen at all, so the whole board is "eliminated" (every region, row and
  // column is a dead unit at once). A deliberately absurd state the UI rewards
  // with a party. Quick-mode auto-marks require a queen, so with no queens on
  // the board every dot must be a manual mark — checking `mark` alone suffices.
  isFullyDotted() {
    if (this.queenCount !== 0) return false;
    for (let r = 0; r < this.N; r++)
      for (let c = 0; c < this.N; c++) if (!this.mark[r][c]) return false;
    return true;
  }
}

function grid(N, val) {
  return Array.from({ length: N }, () => new Array(N).fill(val));
}
