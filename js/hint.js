// hint.js
// Finds the simplest next logical deduction for the current board and returns
// it as structured data the UI can visualise and explain — never just "the
// answer", but reasoning a person can follow.
//
// Design goal: every hint must be understandable. We therefore only ever show:
//   - a wrong queen (mistake),
//   - a naked single: only one cell left in a region / row / column (place),
//   - a line <-> region confinement (eliminate),
//   - otherwise, the next FORCED placement found by full internal deduction,
//     presented as "only one cell remains here" with the surprising exclusions
//     hatched. We never surface raw multi-step "look-ahead contradiction"
//     reasoning, which is correct but impossible to follow.

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

// ---- Mutable deduction state -------------------------------------------------

function makeState(N) {
  return {
    cand: emptyGrid(N, true),
    rowQ: new Array(N).fill(false),
    colQ: new Array(N).fill(false),
    regQ: new Array(N).fill(false),
  };
}

function cloneState(st) {
  return {
    cand: st.cand.map((row) => row.slice()),
    rowQ: st.rowQ.slice(),
    colQ: st.colQ.slice(),
    regQ: st.regQ.slice(),
  };
}

function placeInState(st, N, region, regionCells, r, c) {
  const reg = region[r][c];
  st.rowQ[r] = true;
  st.colQ[c] = true;
  st.regQ[reg] = true;
  for (let i = 0; i < N; i++) {
    st.cand[r][i] = false;
    st.cand[i][c] = false;
  }
  for (const [rr, cc] of regionCells[reg]) st.cand[rr][cc] = false;
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < N && nc >= 0 && nc < N) st.cand[nr][nc] = false;
    }
}

// Candidate state implied by the player's correct queens, plus their own dots
// (honoured only where they agree with the solution, so a wrong dot can never
// mislead a hint).
function deriveState(N, region, regionCells, queens, marks, solution) {
  const st = makeState(N);
  for (const [r, c] of queens) placeInState(st, N, region, regionCells, r, c);
  if (marks) {
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) if (marks[r][c] && solution[r] !== c) st.cand[r][c] = false;
  }
  return st;
}

// Candidate cells of a unit that still needs a queen.
function unitCandidates(cells, st) {
  const out = [];
  for (const [r, c] of cells) if (st.cand[r][c]) out.push([r, c]);
  return out;
}

// First naked single: a unit with no queen and exactly one candidate. Regions
// first (most intuitive), then rows, then columns. Returns null if none.
function firstNakedSingle(st, N, regionCells) {
  for (let reg = 0; reg < N; reg++) {
    if (st.regQ[reg]) continue;
    const cs = unitCandidates(regionCells[reg], st);
    if (cs.length === 1) return { target: cs[0], unitKind: 'region', unitCells: regionCells[reg] };
  }
  for (let r = 0; r < N; r++) {
    if (st.rowQ[r]) continue;
    const cs = unitCandidates(rowCells(N, r), st);
    if (cs.length === 1) return { target: cs[0], unitKind: 'row', unitCells: rowCells(N, r) };
  }
  for (let c = 0; c < N; c++) {
    if (st.colQ[c]) continue;
    const cs = unitCandidates(colCells(N, c), st);
    if (cs.length === 1) return { target: cs[0], unitKind: 'col', unitCells: colCells(N, c) };
  }
  return null;
}

// Line <-> region confinement. Returns an eliminate descriptor or null.
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

// Apply one round of confinement eliminations in place. Returns true if changed.
function applyConfinement(st, N, region, regionCells) {
  let changed = false;
  const kill = (r, c) => {
    if (st.cand[r][c]) {
      st.cand[r][c] = false;
      changed = true;
    }
  };
  for (let reg = 0; reg < N; reg++) {
    if (st.regQ[reg]) continue;
    const cs = unitCandidates(regionCells[reg], st);
    if (cs.length < 2) continue;
    const rows = new Set(cs.map(([r]) => r));
    const cols = new Set(cs.map(([, c]) => c));
    if (rows.size === 1) {
      const r = cs[0][0];
      for (let c = 0; c < N; c++) if (region[r][c] !== reg) kill(r, c);
    }
    if (cols.size === 1) {
      const c = cs[0][1];
      for (let r = 0; r < N; r++) if (region[r][c] !== reg) kill(r, c);
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
        for (const [r, c] of regionCells[reg]) if (isRow ? r !== u : c !== u) kill(r, c);
      }
    }
  };
  lineToRegion(true);
  lineToRegion(false);
  return changed;
}

// Basic propagation (place naked singles + confinement) to a fixed point.
// Returns { contradiction } — a unit with no queen and no candidate.
function propagateBasic(st, N, region, regionCells) {
  for (;;) {
    // contradiction?
    for (let reg = 0; reg < N; reg++)
      if (!st.regQ[reg] && unitCandidates(regionCells[reg], st).length === 0) return { contradiction: true };
    for (let r = 0; r < N; r++)
      if (!st.rowQ[r] && unitCandidates(rowCells(N, r), st).length === 0) return { contradiction: true };
    for (let c = 0; c < N; c++)
      if (!st.colQ[c] && unitCandidates(colCells(N, c), st).length === 0) return { contradiction: true };

    const ns = firstNakedSingle(st, N, regionCells);
    if (ns) {
      placeInState(st, N, region, regionCells, ns.target[0], ns.target[1]);
      continue;
    }
    if (applyConfinement(st, N, region, regionCells)) continue;
    return { contradiction: false };
  }
}

// One round of single-cell look-ahead eliminations (used only internally to
// reach the next forced placement — never surfaced to the player). Returns true
// if any candidate was eliminated.
function applyLookaheadOnce(st, N, region, regionCells) {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!st.cand[r][c]) continue;
      const trial = cloneState(st);
      placeInState(trial, N, region, regionCells, r, c);
      if (propagateBasic(trial, N, region, regionCells).contradiction) {
        st.cand[r][c] = false;
        return true;
      }
    }
  }
  return false;
}

// The next queen that pure deduction forces, and the unit that forces it. Runs
// confinement + look-ahead internally until some unit is down to one candidate.
function nextForcedPlacement(playerState, N, region, regionCells) {
  const st = cloneState(playerState);
  for (let guard = 0; guard < N * N * 4; guard++) {
    const ns = firstNakedSingle(st, N, regionCells);
    if (ns) return ns;
    if (applyConfinement(st, N, region, regionCells)) continue;
    if (applyLookaheadOnce(st, N, region, regionCells)) continue;
    return null;
  }
  return null;
}

function placeHint(title, text, unitCells, target, excludedCells) {
  return {
    kind: 'place',
    title,
    text,
    reasonCells: unitCells,
    lineCells: [],
    excludedCells: excludedCells || [],
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
    applyLabel: 'Felder markieren',
  };
}

const UNIT_WORD = { region: 'Farbregion', row: 'Zeile', col: 'Spalte' };

/**
 * @param {number} N
 * @param {number[][]} region region id per cell
 * @param {number[]} solution cols[r] = column of the queen in row r (unique)
 * @param {[number,number][]} queens the player's placed queens
 * @param {boolean[][]} [marks] the player's manual dots (optional)
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
        excludedCells: [],
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
  const playerState = deriveState(N, region, regionCells, correct, marks, solution);

  // 2. Naked single visible right now.
  const ns = firstNakedSingle(playerState, N, regionCells);
  if (ns) {
    return placeHint(
      `Nur ein Feld in der ${UNIT_WORD[ns.unitKind]}`,
      `In dieser ${UNIT_WORD[ns.unitKind]} ist nur noch dieses eine Feld frei – alle anderen sind ausgeschlossen. Hier muss die Dame stehen.`,
      ns.unitCells,
      ns.target
    );
  }

  // 3. Line <-> region confinement (a clear elimination).
  const conf = findConfinement(playerState, N, region, regionCells);
  if (conf) return conf;

  // 4. Otherwise reach the next forced placement by full internal deduction and
  //    present it plainly. The cells the player still sees as "open" but that
  //    deduction has ruled out are hatched, so "only one remains" is visible.
  const forced = nextForcedPlacement(playerState, N, region, regionCells);
  if (forced) {
    const [tr, tc] = forced.target;
    const excluded = forced.unitCells.filter(
      ([r, c]) => playerState.cand[r][c] && !(r === tr && c === tc)
    );
    return placeHint(
      `Nur ein Feld in der ${UNIT_WORD[forced.unitKind]}`,
      `In dieser ${UNIT_WORD[forced.unitKind]} bleibt am Ende nur dieses Feld möglich – die schraffierten Felder sind ausgeschlossen. Hier muss die Dame stehen.`,
      forced.unitCells,
      forced.target,
      excluded
    );
  }

  // 5. Fallback (essentially never hit): reveal the next queen directly.
  let best = null;
  for (let reg = 0; reg < N; reg++) {
    if (playerState.regQ[reg]) continue;
    const cs = unitCandidates(regionCells[reg], playerState);
    if (!best || cs.length < best.count) best = { reg, count: cs.length };
  }
  if (best) {
    let target = null;
    for (let r = 0; r < N; r++) if (region[r][solution[r]] === best.reg) target = [r, solution[r]];
    if (target)
      return placeHint('Nächste Dame', 'Hier gehört die nächste Dame hin.', regionCells[best.reg], target);
  }
  return { kind: 'none', title: 'Kein Hinweis', text: 'Gerade ist kein einfacher Hinweis verfügbar.' };
}
