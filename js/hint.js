// hint.js
// Finds the simplest next logical deduction for the current board and returns
// it as structured data the UI can visualise and explain — never just "the
// answer", but the reasoning behind one concrete next step.
//
// A hint is derived from pure logic (the puzzle's real constraints), using only
// the player's CORRECT queens as given facts; the player's dots are notes and
// are ignored. The techniques mirror the difficulty tiers of the solver:
//   - naked single      (only one cell left in a region / row / column)
//   - line ↔ region     (a colour confined to one line, or vice versa)
//   - look-ahead        (a cell whose queen would empty some unit)
// plus mistake detection and a reveal fallback so a hint always exists.

function emptyGrid(N, v) {
  return Array.from({ length: N }, () => new Array(N).fill(v));
}

function groupRegions(N, region) {
  const cells = Array.from({ length: N }, () => []);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cells[region[r][c]].push([r, c]);
  return cells;
}

// Candidate grid + per-unit "has a queen" flags implied by the given queens.
// The player's own dots are also honoured as eliminations, but only where they
// agree with the solution — so a stray (wrong) dot can never mislead a hint.
function deriveCandidates(N, region, queens, marks, solution) {
  const cand = emptyGrid(N, true);
  const rowQ = new Array(N).fill(false);
  const colQ = new Array(N).fill(false);
  const regQ = new Array(N).fill(false);

  const place = (r, c) => {
    const reg = region[r][c];
    rowQ[r] = true;
    colQ[c] = true;
    regQ[reg] = true;
    for (let i = 0; i < N; i++) {
      cand[r][i] = false;
      cand[i][c] = false;
    }
    for (let rr = 0; rr < N; rr++)
      for (let cc = 0; cc < N; cc++) if (region[rr][cc] === reg) cand[rr][cc] = false;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) cand[nr][nc] = false;
      }
  };
  for (const [r, c] of queens) place(r, c);
  if (marks) {
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) if (marks[r][c] && solution[r] !== c) cand[r][c] = false;
  }
  return { cand, rowQ, colQ, regQ };
}

// Apply naked-single propagation to a fixed point on a copied state. Returns the
// cells of the first unit that ends up empty (a contradiction), or null.
function propagateForContradiction(N, region, regionCells, cand, rowQ, colQ, regQ) {
  cand = cand.map((row) => row.slice());
  rowQ = rowQ.slice();
  colQ = colQ.slice();
  regQ = regQ.slice();

  const place = (r, c) => {
    const reg = region[r][c];
    rowQ[r] = colQ[c] = regQ[reg] = true;
    for (let i = 0; i < N; i++) {
      cand[r][i] = false;
      cand[i][c] = false;
    }
    for (const [rr, cc] of regionCells[reg]) cand[rr][cc] = false;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) cand[nr][nc] = false;
      }
  };

  let changed = true;
  while (changed) {
    changed = false;
    // rows
    for (let r = 0; r < N; r++) {
      if (rowQ[r]) continue;
      const cs = [];
      for (let c = 0; c < N; c++) if (cand[r][c]) cs.push([r, c]);
      if (cs.length === 0) return rowCells(N, r);
      if (cs.length === 1) {
        place(cs[0][0], cs[0][1]);
        changed = true;
      }
    }
    // columns
    for (let c = 0; c < N; c++) {
      if (colQ[c]) continue;
      const cs = [];
      for (let r = 0; r < N; r++) if (cand[r][c]) cs.push([r, c]);
      if (cs.length === 0) return colCells(N, c);
      if (cs.length === 1) {
        place(cs[0][0], cs[0][1]);
        changed = true;
      }
    }
    // regions
    for (let reg = 0; reg < N; reg++) {
      if (regQ[reg]) continue;
      const cs = regionCells[reg].filter(([r, c]) => cand[r][c]);
      if (cs.length === 0) return regionCells[reg].slice();
      if (cs.length === 1) {
        place(cs[0][0], cs[0][1]);
        changed = true;
      }
    }
  }
  return null;
}

const rowCells = (N, r) => Array.from({ length: N }, (_, c) => [r, c]);
const colCells = (N, c) => Array.from({ length: N }, (_, r) => [r, c]);

/**
 * @param {number} N
 * @param {number[][]} region region id per cell
 * @param {number[]} solution cols[r] = column of the queen in row r (unique sol.)
 * @param {[number,number][]} queens the player's placed queens
 * @param {boolean[][]} [marks] the player's manual dots (optional)
 * @returns hint descriptor (see bottom of file for shape)
 */
export function computeHint(N, region, solution, queens, marks) {
  // 1. A wrong queen: point it out before anything else.
  for (const [r, c] of queens) {
    if (solution[r] !== c) {
      return {
        kind: 'mistake',
        title: 'Diese Dame passt nicht',
        text: 'Diese Dame kann nicht Teil der Lösung sein. Nimm sie zurück und probiere es an einer anderen Stelle.',
        reasonCells: [],
        lineCells: [],
        targetCells: [[r, c]],
        applyLabel: 'Dame entfernen',
      };
    }
  }

  const correct = queens.filter(([r, c]) => solution[r] === c);
  if (correct.length === N) {
    return { kind: 'none', title: 'Alles gelöst', text: 'Alle Damen stehen richtig – gut gemacht!' };
  }

  const regionCells = groupRegions(N, region);
  const { cand, rowQ, colQ, regQ } = deriveCandidates(N, region, correct, marks, solution);

  // 2. Naked single — regions first (most intuitive), then rows, then columns.
  for (let reg = 0; reg < N; reg++) {
    if (regQ[reg]) continue;
    const cs = regionCells[reg].filter(([r, c]) => cand[r][c]);
    if (cs.length === 1) {
      return {
        kind: 'place',
        title: 'Nur ein Feld möglich',
        text: 'In dieser Farbregion ist nur noch dieses eine Feld frei – alle anderen sind durch bereits gesetzte Damen ausgeschlossen. Hier muss die Dame stehen.',
        reasonCells: regionCells[reg].slice(),
        lineCells: [],
        targetCells: [cs[0]],
        applyLabel: 'Dame setzen',
      };
    }
  }
  for (let r = 0; r < N; r++) {
    if (rowQ[r]) continue;
    const cs = [];
    for (let c = 0; c < N; c++) if (cand[r][c]) cs.push([r, c]);
    if (cs.length === 1) {
      return {
        kind: 'place',
        title: 'Nur ein Feld in der Zeile',
        text: 'In dieser Zeile ist nur noch dieses Feld möglich. Hier muss die Dame stehen.',
        reasonCells: rowCells(N, r),
        lineCells: [],
        targetCells: [cs[0]],
        applyLabel: 'Dame setzen',
      };
    }
  }
  for (let c = 0; c < N; c++) {
    if (colQ[c]) continue;
    const cs = [];
    for (let r = 0; r < N; r++) if (cand[r][c]) cs.push([r, c]);
    if (cs.length === 1) {
      return {
        kind: 'place',
        title: 'Nur ein Feld in der Spalte',
        text: 'In dieser Spalte ist nur noch dieses Feld möglich. Hier muss die Dame stehen.',
        reasonCells: colCells(N, c),
        lineCells: [],
        targetCells: [cs[0]],
        applyLabel: 'Dame setzen',
      };
    }
  }

  // 3. Line ↔ region intersection.
  for (let reg = 0; reg < N; reg++) {
    if (regQ[reg]) continue;
    const cs = regionCells[reg].filter(([r, c]) => cand[r][c]);
    if (cs.length < 2) continue;
    const rows = new Set(cs.map(([r]) => r));
    const cols = new Set(cs.map(([, c]) => c));
    if (rows.size === 1) {
      const r = cs[0][0];
      const elim = [];
      for (let c = 0; c < N; c++) if (cand[r][c] && region[r][c] !== reg) elim.push([r, c]);
      if (elim.length)
        return t1Hint('Farbe legt die Zeile fest',
          'Alle möglichen Felder dieser Farbe liegen in einer Zeile. Die Dame dieser Zeile gehört also zu dieser Farbe – die übrigen Felder der Zeile scheiden aus.',
          cs, rowCells(N, r), elim);
    }
    if (cols.size === 1) {
      const c = cs[0][1];
      const elim = [];
      for (let r = 0; r < N; r++) if (cand[r][c] && region[r][c] !== reg) elim.push([r, c]);
      if (elim.length)
        return t1Hint('Farbe legt die Spalte fest',
          'Alle möglichen Felder dieser Farbe liegen in einer Spalte. Die Dame dieser Spalte gehört also zu dieser Farbe – die übrigen Felder der Spalte scheiden aus.',
          cs, colCells(N, c), elim);
    }
  }
  const lineToRegion = (isRow) => {
    for (let u = 0; u < N; u++) {
      if ((isRow ? rowQ : colQ)[u]) continue;
      const cs = [];
      for (let k = 0; k < N; k++) {
        const r = isRow ? u : k;
        const c = isRow ? k : u;
        if (cand[r][c]) cs.push([r, c]);
      }
      if (cs.length < 2) continue;
      const regs = new Set(cs.map(([r, c]) => region[r][c]));
      if (regs.size === 1) {
        const reg = region[cs[0][0]][cs[0][1]];
        const elim = regionCells[reg].filter(
          ([r, c]) => cand[r][c] && (isRow ? r !== u : c !== u)
        );
        if (elim.length)
          return t1Hint(
            isRow ? 'Zeile legt die Farbe fest' : 'Spalte legt die Farbe fest',
            `In dieser ${isRow ? 'Zeile' : 'Spalte'} sind nur noch Felder einer einzigen Farbe möglich. Die Dame dieser Farbe liegt also in dieser ${isRow ? 'Zeile' : 'Spalte'} – ihre Felder in anderen ${isRow ? 'Zeilen' : 'Spalten'} scheiden aus.`,
            cs, cs.slice(), elim
          );
      }
    }
    return null;
  };
  const lr = lineToRegion(true) || lineToRegion(false);
  if (lr) return lr;

  // 4. Look-ahead: a candidate whose queen would empty some unit.
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!cand[r][c]) continue;
      const cand2 = cand.map((row) => row.slice());
      const rowQ2 = rowQ.slice();
      const colQ2 = colQ.slice();
      const regQ2 = regQ.slice();
      const reg = region[r][c];
      rowQ2[r] = colQ2[c] = regQ2[reg] = true;
      for (let i = 0; i < N; i++) {
        cand2[r][i] = false;
        cand2[i][c] = false;
      }
      for (const [rr, cc] of regionCells[reg]) cand2[rr][cc] = false;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < N && nc >= 0 && nc < N) cand2[nr][nc] = false;
        }
      const emptied = propagateForContradiction(N, region, regionCells, cand2, rowQ2, colQ2, regQ2);
      if (emptied) {
        return {
          kind: 'eliminate',
          title: 'Führt zum Widerspruch',
          text: 'Stünde hier eine Dame, bliebe in den hervorgehobenen Feldern kein Platz mehr für eine Dame. Dieses Feld scheidet deshalb aus.',
          reasonCells: emptied,
          lineCells: [],
          targetCells: [[r, c]],
          applyLabel: 'Feld markieren',
        };
      }
    }
  }

  // 5. Fallback (essentially never hit for our fair puzzles): reveal the next
  //    queen in the region that has the fewest open cells.
  let best = null;
  for (let reg = 0; reg < N; reg++) {
    if (regQ[reg]) continue;
    const cs = regionCells[reg].filter(([r, c]) => cand[r][c]);
    if (!best || cs.length < best.count) best = { reg, count: cs.length };
  }
  if (best) {
    let target = null;
    for (let r = 0; r < N; r++) if (region[r][solution[r]] === best.reg) target = [r, solution[r]];
    if (target)
      return {
        kind: 'place',
        title: 'Nächste Dame',
        text: 'Hier gehört die nächste Dame hin.',
        reasonCells: regionCells[best.reg].slice(),
        lineCells: [],
        targetCells: [target],
        applyLabel: 'Dame setzen',
      };
  }
  return { kind: 'none', title: 'Kein Hinweis', text: 'Gerade ist kein einfacher Hinweis verfügbar.' };
}

function t1Hint(title, text, reasonCells, lineCells, elim) {
  return { kind: 'eliminate', title, text, reasonCells, lineCells, targetCells: elim, applyLabel: 'Felder markieren' };
}
