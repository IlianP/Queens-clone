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

  clearMarks() {
    this.mark = grid(this.N, false);
  }

  // Cycle a cell: empty -> mark (X) -> queen -> empty.
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

  isWon() {
    return this.queenCount === this.N && this.conflicts().size === 0;
  }
}

function grid(N, val) {
  return Array.from({ length: N }, () => new Array(N).fill(val));
}
