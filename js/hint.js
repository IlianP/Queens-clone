// hint.js
// Finds the simplest next logical deduction for the current board and returns
// it as structured data the UI can visualise and explain — never just "the
// answer", but reasoning a person can follow on the board.
//
// It uses exactly the techniques the generator guarantees a puzzle is solvable
// with, so a comprehensible hint always exists:
//   - mistake:     a queen that isn't part of the solution,
//   - naked single: only one cell left in a region / row / column (place),
//   - confinement:  a colour confined to one line, or a line to one colour (X),
//   - dead-end:     a queen here would wipe out a whole other unit, so it's out.
// A reveal fallback exists but is essentially never needed.

function emptyGrid(N, v) {
  return Array.from({ length: N }, () => new Array(N).fill(v));
}

function groupRegions(N, region) {
  const cells = Array.from({ length: N }, () => []);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) cells[region[r][c]].push([r, c]);
  return cells;
}

const rowCells = (N, r) => Array.from({ length: N }, (_, c) => [r, c]);
const colCells = (N, c) => Array.from({ length: N }, (_, r) => [r, c]);

// Candidate state implied by the player's correct queens, plus their own dots
// (honoured only where they agree with the solution, so a wrong dot can never
// mislead a hint).
function deriveState(N, region, regionCells, queens, marks, solution) {
  const cand = emptyGrid(N, true);
  const rowQ = new Array(N).fill(false);
  const colQ = new Array(N).fill(false);
  const regQ = new Array(N).fill(false);
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
  for (const [r, c] of queens) place(r, c);
  if (marks) {
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) if (marks[r][c] && solution[r] !== c) cand[r][c] = false;
  }
  return { cand, rowQ, colQ, regQ };
}

function unitCandidates(cells, st) {
  const out = [];
  for (const [r, c] of cells) if (st.cand[r][c]) out.push([r, c]);
  return out;
}

const UNIT_WORD = { region: 'Farbregion', row: 'Zeile', col: 'Spalte' };

function placeHint(unitKind, target, unitCells) {
  return {
    kind: 'place',
    title: `Nur ein Feld in der ${UNIT_WORD[unitKind]}`,
    text: `In dieser ${UNIT_WORD[unitKind]} ist nur noch dieses eine Feld frei – alle anderen sind ausgeschlossen. Hier muss die Dame stehen.`,
    reasonCells: unitCells,
    lineCells: [],
    excludedCells: [],
    targetCells: [target],
    applyLabel: 'Dame setzen',
  };
}

function elimHint(title, text, reasonCells, elim) {
  return {
    kind: 'eliminate',
    title,
    text,
    reasonCells,
    lineCells: [],
    excludedCells: [],
    targetCells: elim,
    applyLabel: elim.length > 1 ? 'Felder markieren' : 'Feld markieren',
  };
}

// Naked single: a unit with no queen and exactly one candidate.
function findNakedSingle(st, N, regionCells) {
  for (let reg = 0; reg < N; reg++)
    if (!st.regQ[reg]) {
      const cs = unitCandidates(regionCells[reg], st);
      if (cs.length === 1) return placeHint('region', cs[0], regionCells[reg]);
    }
  for (let r = 0; r < N; r++)
    if (!st.rowQ[r]) {
      const cs = unitCandidates(rowCells(N, r), st);
      if (cs.length === 1) return placeHint('row', cs[0], rowCells(N, r));
    }
  for (let c = 0; c < N; c++)
    if (!st.colQ[c]) {
      const cs = unitCandidates(colCells(N, c), st);
      if (cs.length === 1) return placeHint('col', cs[0], colCells(N, c));
    }
  return null;
}

// Line <-> region confinement.
function findConfinement(st, N, region, regionCells) {
  for (let reg = 0; reg < N; reg++) {
    if (st.regQ[reg]) continue;
    const cs = unitCandidates(regionCells[reg], st);
    if (cs.length < 2) continue;
    const rows = new Set(cs.map(([r]) => r));
    const cols = new Set(cs.map(([, c]) => c));
    if (rows.size === 1) {
      const r = cs[0][0];
      const elim = [];
      for (let c = 0; c < N; c++) if (st.cand[r][c] && region[r][c] !== reg) elim.push([r, c]);
      if (elim.length)
        return elimHint('Farbe legt die Zeile fest',
          'Alle möglichen Felder dieser Farbe liegen in einer Zeile. Die Dame dieser Zeile gehört also zu dieser Farbe – die übrigen Felder der Zeile scheiden aus.',
          cs, elim);
    }
    if (cols.size === 1) {
      const c = cs[0][1];
      const elim = [];
      for (let r = 0; r < N; r++) if (st.cand[r][c] && region[r][c] !== reg) elim.push([r, c]);
      if (elim.length)
        return elimHint('Farbe legt die Spalte fest',
          'Alle möglichen Felder dieser Farbe liegen in einer Spalte. Die Dame dieser Spalte gehört also zu dieser Farbe – die übrigen Felder der Spalte scheiden aus.',
          cs, elim);
    }
  }
  const lineToRegion = (isRow) => {
    for (let u = 0; u < N; u++) {
      if ((isRow ? st.rowQ : st.colQ)[u]) continue;
      const line = isRow ? rowCells(N, u) : colCells(N, u);
      const cs = unitCandidates(line, st);
      if (cs.length < 2) continue;
      const regs = new Set(cs.map(([r, c]) => region[r][c]));
      if (regs.size === 1) {
        const reg = region[cs[0][0]][cs[0][1]];
        const elim = unitCandidates(regionCells[reg], st).filter(([r, c]) => (isRow ? r !== u : c !== u));
        if (elim.length)
          return elimHint(
            isRow ? 'Zeile legt die Farbe fest' : 'Spalte legt die Farbe fest',
            `In dieser ${isRow ? 'Zeile' : 'Spalte'} sind nur noch Felder einer einzigen Farbe möglich. Die Dame dieser Farbe liegt also in dieser ${isRow ? 'Zeile' : 'Spalte'} – ihre Felder in anderen ${isRow ? 'Zeilen' : 'Spalten'} scheiden aus.`,
            cs, elim);
      }
    }
    return null;
  };
  return lineToRegion(true) || lineToRegion(false);
}

// Direct dead-end: a queen on X would wipe out every remaining cell of some
// other unit U, so X is impossible. Highlights the blocked cells (out) and U
// (its free cells).
//
// Any cell whose queen would attack every free cell of U is impossible for the
// exact same reason, so we gather them all and eliminate them together in one
// hint — otherwise the player gets a string of near-identical hints for cells
// that (often literally next to each other) all fail against the same unit.
function findDeadEnd(st, N, region, regionCells) {
  // Every candidate cell (outside U) whose queen would attack all of U's free
  // cells. X isn't a member of U precisely when it isn't one of those cells.
  const blockersOf = (cs) => {
    const out = [];
    for (let xr = 0; xr < N; xr++)
      for (let xc = 0; xc < N; xc++) {
        if (!st.cand[xr][xc]) continue;
        if (cs.some(([r, c]) => r === xr && c === xc)) continue;
        const xg = region[xr][xc];
        const attacks = (r, c) =>
          r === xr || c === xc || region[r][c] === xg || (Math.abs(r - xr) <= 1 && Math.abs(c - xc) <= 1);
        if (cs.every(([r, c]) => attacks(r, c))) out.push([xr, xc]);
      }
    return out;
  };

  const make = (cs, unitWord) => {
    const elim = blockersOf(cs);
    if (!elim.length) return null;
    const many = elim.length > 1;
    return elimHint(
      `Würde eine ${unitWord} blockieren`,
      `Eine Dame auf ${many ? 'einem dieser Felder' : 'diesem Feld'} würde jedes noch freie Feld dieser ${unitWord} ausschließen (gleiche Zeile, Spalte, Farbe oder direkt daneben). Da die ${unitWord} aber eine Dame braucht, ${many ? 'scheiden diese Felder aus' : 'scheidet dieses Feld aus'}.`,
      cs,
      elim
    );
  };

  for (let xr = 0; xr < N; xr++) {
    for (let xc = 0; xc < N; xc++) {
      if (!st.cand[xr][xc]) continue;
      const xg = region[xr][xc];
      const attacks = (r, c) =>
        r === xr || c === xc || region[r][c] === xg || (Math.abs(r - xr) <= 1 && Math.abs(c - xc) <= 1);

      const check = (cells, unitWord) => {
        const cs = unitCandidates(cells, st);
        if (!cs.length) return null;
        if (cs.every(([r, c]) => attacks(r, c))) return make(cs, unitWord);
        return null;
      };

      for (let r = 0; r < N; r++) {
        if (st.rowQ[r] || r === xr) continue;
        const h = check(rowCells(N, r), 'Zeile');
        if (h) return h;
      }
      for (let c = 0; c < N; c++) {
        if (st.colQ[c] || c === xc) continue;
        const h = check(colCells(N, c), 'Spalte');
        if (h) return h;
      }
      for (let g = 0; g < N; g++) {
        if (st.regQ[g] || g === xg) continue;
        const h = check(regionCells[g], 'Farbregion');
        if (h) return h;
      }
    }
  }
  return null;
}

// Crowding (Hall sets): if the candidates of k units on one side only touch k
// units on the other side, those k are locked together — cells of those units
// elsewhere are eliminated. Mirrors solver._hall but returns an explained hint.
function findCrowding(st, N, region, regionCells) {
  const rowsCellsAll = Array.from({ length: N }, (_, r) => rowCells(N, r).map(([rr, cc]) => rr * N + cc));
  const colsCellsAll = Array.from({ length: N }, (_, c) => colCells(N, c).map(([rr, cc]) => rr * N + cc));
  const regCellsIdx = Array.from({ length: N }, (_, g) => regionCells[g].map(([r, c]) => r * N + c));
  const cand = (idx) => st.cand[(idx / N) | 0][idx % N];
  const rowOf = (idx) => (idx / N) | 0;
  const colOf = (idx) => idx % N;
  const regionOf = (idx) => region[(idx / N) | 0][idx % N];
  const popcount = (x) => {
    let n = 0;
    while (x) {
      x &= x - 1;
      n++;
    }
    return n;
  };

  const run = (primCells, primHasQ, primOf, secOf, primIsLine, describe) => {
    const masks = new Array(N).fill(0);
    const active = [];
    for (let p = 0; p < N; p++) {
      if (primHasQ[p]) continue;
      let m = 0;
      let any = false;
      for (const idx of primCells[p]) if (cand(idx)) { m |= 1 << secOf(idx); any = true; }
      if (any) { masks[p] = m; active.push(p); }
    }
    const CAP = 4;

    const build = (combo, orMask) => {
      let sMask = 0;
      for (const p of combo) sMask |= 1 << p;
      const elim = [];
      for (let idx = 0; idx < N * N; idx++) {
        if (!cand(idx)) continue;
        if (((orMask >> secOf(idx)) & 1) && !((sMask >> primOf(idx)) & 1)) elim.push([(idx / N) | 0, idx % N]);
      }
      if (!elim.length) return null;
      // Reason = only the candidate cells in the k units — exactly the k colours
      // involved, so nothing misleading of another colour gets highlighted.
      const reason = [];
      for (const p of combo)
        for (const idx of primCells[p]) if (cand(idx)) reason.push([(idx / N) | 0, idx % N]);
      return { elim, reason, k: combo.length, describe };
    };

    // Prefer the smallest Hall set (2 before 3 before 4): far easier to grasp.
    let found = null;
    const combo = [];
    const search = (target) => {
      const rec = (start, orMask) => {
        if (found) return;
        if (combo.length === target) {
          if (popcount(orMask) === target) found = build(combo, orMask);
          return;
        }
        for (let i = start; i < active.length && !found; i++) {
          const nm = orMask | masks[active[i]];
          if (popcount(nm) > target) continue;
          combo.push(active[i]);
          rec(i + 1, nm);
          combo.pop();
        }
      };
      rec(0, 0);
    };
    for (let size = 2; size <= CAP && !found; size++) search(size);
    return found;
  };

  const f =
    run(rowsCellsAll, st.rowQ, rowOf, regionOf, true, (k) => [`${k} Farben passen nur in ${k} Zeilen`, `In den ${k} hervorgehobenen Zeilen kommen nur ${k} Farben vor. Diese ${k} Farben müssen also in genau diese Zeilen – dieselben Farben scheiden in allen anderen Zeilen aus (schraffiert).`]) ||
    run(colsCellsAll, st.colQ, colOf, regionOf, true, (k) => [`${k} Farben passen nur in ${k} Spalten`, `In den ${k} hervorgehobenen Spalten kommen nur ${k} Farben vor. Diese ${k} Farben müssen also in genau diese Spalten – dieselben Farben scheiden in allen anderen Spalten aus (schraffiert).`]) ||
    run(regCellsIdx, st.regQ, regionOf, rowOf, false, (k) => [`${k} Farben belegen ${k} Zeilen`, `Die ${k} hervorgehobenen Farben passen nur in ${k} Zeilen. Diese Zeilen gehören also diesen Farben – andere Farben scheiden in diesen Zeilen aus (schraffiert).`]) ||
    run(regCellsIdx, st.regQ, regionOf, colOf, false, (k) => [`${k} Farben belegen ${k} Spalten`, `Die ${k} hervorgehobenen Farben passen nur in ${k} Spalten. Diese Spalten gehören also diesen Farben – andere Farben scheiden in diesen Spalten aus (schraffiert).`]);

  if (!f) return null;
  const [title, text] = f.describe(f.k);
  return elimHint(title, text, f.reason, f.elim);
}

/**
 * @param {number} N
 * @param {number[][]} region region id per cell
 * @param {number[]} solution cols[r] = column of the queen in row r (unique)
 * @param {[number,number][]} queens the player's placed queens
 * @param {boolean[][]} [marks] the player's manual dots (optional)
 */
export function computeHint(N, region, solution, queens, marks) {
  for (const [r, c] of queens) {
    if (solution[r] !== c) {
      return {
        kind: 'mistake',
        title: 'Diese Dame passt nicht',
        text: 'Diese Dame kann nicht Teil der Lösung sein. Nimm sie zurück und probiere es an einer anderen Stelle.',
        reasonCells: [],
        lineCells: [],
        excludedCells: [],
        targetCells: [[r, c]],
        applyLabel: 'Dame entfernen',
      };
    }
  }

  const correct = queens.filter(([r, c]) => solution[r] === c);
  const regionCells = groupRegions(N, region);
  const st = deriveState(N, region, regionCells, correct, marks, solution);

  // A dot on a cell that must hold a queen (a solution cell) is a mistake, and
  // pointing it out comes before any deduction elsewhere. When that cell is the
  // last free cell of its row, column or colour region, "unmark it" isn't the
  // whole story — the queen belongs there — so we offer the placement directly
  // (applying it clears the dot and sets the queen), rather than telling the
  // player to undo a dot only to be told to place that very queen on the next
  // hint. Otherwise we just ask for the dot to be removed. deriveState already
  // ignores a dot sitting on a solution cell, so `st` reflects the board as if
  // the wrong dot weren't there.
  if (marks) {
    for (let r = 0; r < N; r++) {
      const c = solution[r];
      if (!marks[r][c]) continue;
      const reg = region[r][c];
      const soleUnit =
        (unitCandidates(regionCells[reg], st).length === 1 && 'Farbregion') ||
        (unitCandidates(rowCells(N, r), st).length === 1 && 'Zeile') ||
        (unitCandidates(colCells(N, c), st).length === 1 && 'Spalte');
      if (soleUnit) {
        const unitCells =
          soleUnit === 'Farbregion' ? regionCells[reg] : soleUnit === 'Zeile' ? rowCells(N, r) : colCells(N, c);
        return {
          kind: 'place',
          title: 'Hier muss die Dame stehen',
          text: `Dieses Feld ist als Ausschluss markiert – dabei ist es das einzige noch freie Feld seiner ${soleUnit}. Entferne die Markierung und setze hier die Dame.`,
          reasonCells: unitCells,
          lineCells: [],
          excludedCells: [],
          targetCells: [[r, c]],
          applyLabel: 'Dame setzen',
        };
      }
      return {
        kind: 'mistake',
        title: 'Hier muss eine Dame stehen',
        text: 'Dieses Feld ist als Ausschluss markiert, obwohl hier eine Dame stehen muss. Entferne die Markierung.',
        reasonCells: [],
        lineCells: [],
        excludedCells: [],
        targetCells: [[r, c]],
        applyLabel: 'Markierung entfernen',
      };
    }
  }

  if (correct.length === N)
    return { kind: 'none', title: 'Alles gelöst', text: 'Alle Damen stehen richtig – gut gemacht!' };

  return (
    findNakedSingle(st, N, regionCells) ||
    findConfinement(st, N, region, regionCells) ||
    findDeadEnd(st, N, region, regionCells) ||
    findCrowding(st, N, region, regionCells) ||
    revealFallback(st, N, region, regionCells, solution)
  );
}

// Only reached for a puzzle that isn't solvable by the explainable techniques
// (shouldn't happen for freshly generated puzzles): honestly reveal the next
// queen rather than inventing a bogus reason.
function revealFallback(st, N, region, regionCells, solution) {
  let best = null;
  for (let reg = 0; reg < N; reg++) {
    if (st.regQ[reg]) continue;
    const cs = unitCandidates(regionCells[reg], st);
    if (!best || cs.length < best.count) best = { reg, count: cs.length };
  }
  if (best) {
    let target = null;
    for (let r = 0; r < N; r++) if (region[r][solution[r]] === best.reg) target = [r, solution[r]];
    if (target) {
      const h = placeHint('region', target, regionCells[best.reg]);
      h.title = 'Nächste Dame';
      h.text = 'Hier gehört die nächste Dame hin.';
      return h;
    }
  }
  return { kind: 'none', title: 'Kein Hinweis', text: 'Gerade ist kein einfacher Hinweis verfügbar.' };
}
