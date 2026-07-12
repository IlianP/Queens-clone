// main.js — wires the puzzle generator, game logic and DOM together.
import { generatePuzzle } from './generator.js';
import { Game } from './game.js';
import { computeHint } from './hint.js';
import { loadSettings, saveSettings, clampSize } from './settings.js';

// Distinct, mildly pastel region colours (supports up to 11 regions).
const PALETTE = [
  '#ff8a8a', '#ffb26b', '#ffe066', '#c1e15b', '#7ed99a', '#66d9cd',
  '#79c7ff', '#8aa2ff', '#bd93f9', '#ff9ed8', '#d0a679', '#c9cdd6',
];

const CROWN = `<svg class="queen" viewBox="0 0 24 24" aria-hidden="true">
  <path fill="currentColor" d="M2.2 8.4l4.3 3.1L11.1 4a1 1 0 0 1 1.8 0l4.6 7.5 4.3-3.1a1 1 0 0 1 1.55 1.05L21 19.2a1 1 0 0 1-.98.8H3.98a1 1 0 0 1-.98-.8L.65 9.45A1 1 0 0 1 2.2 8.4z"/>
  <rect x="3.2" y="20.4" width="17.6" height="2.4" rx="1.1" fill="currentColor"/>
</svg>`;

const el = (id) => document.getElementById(id);

const dom = {
  board: el('board'),
  timer: el('timer'),
  message: el('message'),
  newGame: el('new-game'),
  openSettings: el('open-settings'),
  undo: el('undo'),
  hint: el('hint'),
  resetBoard: el('reset-board'),
  hintCard: el('hint-card'),
  hintTitle: el('hint-title'),
  hintText: el('hint-text'),
  hintLegend: el('hint-legend'),
  hintApply: el('hint-apply'),
  hintClose: el('hint-close'),
  debugMode: el('debug-mode'),
  debugCopy: el('debug-copy'),
  loading: el('loading'),
  winOverlay: el('win-overlay'),
  winTime: el('win-time'),
  winNewGame: el('win-new-game'),
  settingsOverlay: el('settings-overlay'),
  sizeRange: el('size-range'),
  sizeValue: el('size-value'),
  difficulty: el('difficulty'),
  quickMode: el('quick-mode'),
  settingsApply: el('settings-apply'),
  settingsClose: el('settings-close'),
};

let settings = loadSettings();
let game = null;
let currentSolution = null; // cols[r] of the unique solution (for hints)
let cells = []; // cells[r][c] -> HTMLElement
let colorMap = []; // color for each region id
let lastPlaced = null;
let hintActive = false;
let currentHint = null;

// ---------- Timer ----------
// Only counts while the window is focused/visible. Time is accumulated across
// active segments so switching away and back never advances the clock.
let timerId = null;
let timerAccumMs = 0; // time from completed active segments
let timerRunStart = 0; // start of the current active segment (0 = not counting)
let timerDone = false; // puzzle solved -> frozen for good

function isWindowActive() {
  return !document.hidden && document.hasFocus();
}
function currentElapsed() {
  const ms = timerAccumMs + (timerRunStart ? Date.now() - timerRunStart : 0);
  return Math.floor(ms / 1000);
}
function renderTime() {
  const s = currentElapsed();
  dom.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function tick() {
  if (!timerId) timerId = setInterval(renderTime, 1000);
}
function untick() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}
function startTimer() {
  // Fresh clock for a new/reset board.
  untick();
  timerAccumMs = 0;
  timerRunStart = isWindowActive() ? Date.now() : 0;
  timerDone = false;
  if (timerRunStart) tick();
  renderTime();
}
function pauseTimer() {
  if (timerDone || !timerRunStart) return;
  timerAccumMs += Date.now() - timerRunStart;
  timerRunStart = 0;
  untick();
  renderTime();
}
function resumeTimer() {
  if (timerDone || timerRunStart || !game || !isWindowActive()) return;
  timerRunStart = Date.now();
  tick();
  renderTime();
}
function stopTimer() {
  // Puzzle solved: freeze the final time.
  if (timerRunStart) {
    timerAccumMs += Date.now() - timerRunStart;
    timerRunStart = 0;
  }
  timerDone = true;
  untick();
  renderTime();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseTimer();
  else resumeTimer();
});
window.addEventListener('blur', pauseTimer);
window.addEventListener('focus', resumeTimer);

// ---------- New game / generation ----------
function newGame() {
  hide(dom.winOverlay);
  dom.message.textContent = '';
  show(dom.loading);
  const N = settings.size;
  const difficulty = settings.difficulty;
  const budgetMs = N >= 11 ? 3800 : N >= 10 ? 2400 : N >= 8 ? 1400 : 900;

  // Yield a frame so the spinner paints before the (synchronous) generator runs.
  setTimeout(() => {
    const puzzle = generatePuzzle(N, difficulty, { budgetMs });
    buildBoard(N, puzzle.region);
    game = new Game(N, puzzle.region, settings.quickMode);
    currentSolution = puzzle.solution;
    clearHint();
    undoStack = [];
    updateUndoButton();
    updateBoard();
    startTimer();
    hide(dom.loading);
  }, 30);
}

function buildBoard(N, region) {
  // Assign a distinct palette colour per region.
  colorMap = shuffledPalette(N);
  dom.board.style.setProperty('--n', N);
  dom.board.innerHTML = '';
  cells = Array.from({ length: N }, () => new Array(N));

  const frag = document.createDocumentFragment();
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const div = document.createElement('div');
      div.className = 'cell';
      div.dataset.r = r;
      div.dataset.c = c;
      // Use background-COLOR (not the `background` shorthand) so a hint's
      // hatch (a background-image) can layer on top instead of being reset.
      div.style.backgroundColor = colorMap[region[r][c]];
      // Strong borders on region boundaries.
      if (r > 0 && region[r - 1][c] !== region[r][c]) div.classList.add('bt');
      if (r < N - 1 && region[r + 1][c] !== region[r][c]) div.classList.add('bb');
      if (c > 0 && region[r][c - 1] !== region[r][c]) div.classList.add('bl');
      if (c < N - 1 && region[r][c + 1] !== region[r][c]) div.classList.add('br');
      frag.appendChild(div);
      cells[r][c] = div;
    }
  }
  dom.board.appendChild(frag);
}

function shuffledPalette(N) {
  const p = PALETTE.slice(0, Math.max(N, 1));
  for (let i = p.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

// ---------- Render ----------
function updateBoard() {
  const N = game.N;
  const auto = game.autoMarkGrid();
  const conflicts = game.conflicts();
  const dead = game.deadRegions(auto);
  const region = game.region;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = cells[r][c];
      // The base state drives the cell's contents. Manual marks and quick-mode
      // auto-marks look identical (a dot). Conflict is handled purely by a CSS
      // class so a queen never gets its SVG re-parsed (which caused the brief
      // flicker) when a dot elsewhere or its conflict status changes.
      let state = 'empty';
      if (game.queen[r][c]) state = 'queen';
      else if (game.mark[r][c] || auto[r][c]) state = 'dot';

      if (cell.dataset.state !== state) {
        cell.dataset.state = state;
        cell.innerHTML =
          state === 'queen' ? CROWN : state === 'dot' ? '<span class="dot"></span>' : '';
      }
      cell.classList.toggle('conflict', conflicts.has(`${r},${c}`));

      // Outline a region in red once it's a dead end (fully dotted, no queen).
      // The red edges are drawn only on the region's outer sides — where it
      // meets another region or the board edge — so they form one clean border.
      const reg = region[r][c];
      const isDead = dead.has(reg);
      cell.classList.toggle('dead', isDead);
      cell.classList.toggle('dt', isDead && (r === 0 || region[r - 1][c] !== reg));
      cell.classList.toggle('dr', isDead && (c === N - 1 || region[r][c + 1] !== reg));
      cell.classList.toggle('db', isDead && (r === N - 1 || region[r + 1][c] !== reg));
      cell.classList.toggle('dl', isDead && (c === 0 || region[r][c - 1] !== reg));
    }
  }

  if (lastPlaced) {
    const cell = cells[lastPlaced.r]?.[lastPlaced.c];
    if (cell && game.queen[lastPlaced.r][lastPlaced.c]) {
      cell.classList.remove('pop');
      void cell.offsetWidth; // restart animation
      cell.classList.add('pop');
    }
    lastPlaced = null;
  }

  updateMessage();
}

function updateMessage() {
  if (game.isWon()) {
    dom.message.textContent = 'Gelöst! 🎉';
    dom.message.className = 'message ok';
    onWin();
  } else if (game.queenCount === game.N) {
    dom.message.textContent = 'Fast! Es gibt noch Konflikte.';
    dom.message.className = 'message';
  } else {
    dom.message.textContent = '';
    dom.message.className = 'message';
  }
}

function onWin() {
  clearHint();
  stopTimer();
  const total = currentElapsed();
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  dom.winTime.textContent = `Zeit: ${m}:${s}`;
  show(dom.winOverlay);
}

// ---------- Undo ----------
// Each user gesture (a tap, a whole swipe stroke, or a Clear/Reset) snapshots
// the board first. Because quick-mode dots are derived from the queens, undoing
// a queen automatically removes every dot it produced.
let undoStack = [];

function snapshot() {
  return {
    mark: game.mark.map((row) => row.slice()),
    queen: game.queen.map((row) => row.slice()),
    queenCount: game.queenCount,
  };
}
function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 500) undoStack.shift();
  updateUndoButton();
}
function updateUndoButton() {
  dom.undo.disabled = undoStack.length === 0;
}
function doUndo() {
  if (!game || undoStack.length === 0) return;
  const s = undoStack.pop();
  game.mark = s.mark;
  game.queen = s.queen;
  game.queenCount = s.queenCount;
  hide(dom.winOverlay);
  if (timerDone) {
    // A win had frozen the clock; undoing means play continues.
    timerDone = false;
    resumeTimer();
  }
  lastPlaced = null;
  updateBoard();
  updateUndoButton();
}

// ---------- Interaction (tap + swipe) ----------
// A tap cycles a single cell. Press-and-drag paints: the first cell decides
// whether the stroke adds dots (started on an empty cell) or erases them
// (started on a marked cell); queens are never touched by a swipe.
let drag = null;

function paintModeForStart(r, c) {
  if (game.queen[r][c]) return null; // queens are tap-only
  return game.mark[r][c] ? 'clear' : 'mark';
}

function paintCell(r, c) {
  if (game.queen[r][c]) return false;
  const want = drag.mode === 'mark';
  if (game.mark[r][c] === want) return false;
  if (!drag.snapshotted) {
    pushUndo();
    drag.snapshotted = true;
  }
  game.mark[r][c] = want;
  return true;
}

function cellAtPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const cell = el && el.closest ? el.closest('.cell') : null;
  return cell && dom.board.contains(cell) ? cell : null;
}

dom.board.addEventListener('pointerdown', (e) => {
  if (!game || hintActive) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;
  e.preventDefault();
  drag = {
    id: e.pointerId,
    startR: +cell.dataset.r,
    startC: +cell.dataset.c,
    mode: paintModeForStart(+cell.dataset.r, +cell.dataset.c),
    moved: false,
    snapshotted: false,
    lastKey: `${cell.dataset.r},${cell.dataset.c}`,
  };
});

dom.board.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const cell = cellAtPoint(e.clientX, e.clientY);
  if (!cell) return;
  const key = `${cell.dataset.r},${cell.dataset.c}`;
  if (key === drag.lastKey) return; // still on the last-processed cell
  drag.lastKey = key;

  let changed = false;
  if (!drag.moved) {
    drag.moved = true;
    changed = paintCell(drag.startR, drag.startC); // include the start cell
  }
  if (paintCell(+cell.dataset.r, +cell.dataset.c)) changed = true;
  if (changed) updateBoard();
});

function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  if (!drag.moved) {
    // A plain tap: cycle the single cell (empty → dot → queen → empty).
    const { startR: r, startC: c } = drag;
    pushUndo();
    const wasQueen = game.queen[r][c];
    game.tap(r, c);
    if (!wasQueen && game.queen[r][c]) lastPlaced = { r, c };
    updateBoard();
  }
  drag = null;
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// ---------- Hints ----------
function collectQueens() {
  const out = [];
  for (let r = 0; r < game.N; r++)
    for (let c = 0; c < game.N; c++) if (game.queen[r][c]) out.push([r, c]);
  return out;
}

function showHint() {
  if (!game || hintActive) return;
  const hint = computeHint(game.N, game.region, currentSolution, collectQueens(), game.mark);
  renderHint(hint);
}

const LEGEND = {
  reason: '<span><i class="lg-reason"></i>Begründung</span>',
  target: '<span><i class="lg-target"></i>hier setzen</span>',
  x: '<span><i class="lg-x"></i>scheidet aus</span>',
};

function renderHint(hint) {
  currentHint = hint;
  hintActive = true;
  clearHintClasses();
  dom.board.classList.add('hinting');

  for (const [r, c] of hint.lineCells || []) cells[r][c].classList.add('hint-line');
  for (const [r, c] of hint.reasonCells || []) cells[r][c].classList.add('hint-reason');
  for (const [r, c] of hint.excludedCells || []) {
    cells[r][c].classList.remove('hint-reason');
    cells[r][c].classList.add('hint-x');
  }
  const targetClass =
    hint.kind === 'place' ? 'hint-target' : hint.kind === 'mistake' ? 'hint-bad' : 'hint-x';
  for (const [r, c] of hint.targetCells || []) {
    cells[r][c].classList.remove('hint-reason', 'hint-x');
    cells[r][c].classList.add(targetClass);
  }

  dom.hintTitle.textContent = hint.title;
  dom.hintText.textContent = hint.text;

  const legend = [];
  if (hint.reasonCells && hint.reasonCells.length) legend.push(LEGEND.reason);
  if (hint.kind === 'place') legend.push(LEGEND.target);
  if (hint.kind === 'eliminate' || (hint.excludedCells && hint.excludedCells.length))
    legend.push(LEGEND.x);
  dom.hintLegend.innerHTML = legend.join('');

  dom.hintApply.hidden = !hint.applyLabel;
  if (hint.applyLabel) dom.hintApply.textContent = hint.applyLabel;
  show(dom.hintCard);
}

function clearHintClasses() {
  for (const row of cells)
    for (const cell of row)
      cell.classList.remove('hint-reason', 'hint-line', 'hint-target', 'hint-x', 'hint-bad');
}

function clearHint() {
  hintActive = false;
  currentHint = null;
  dom.board.classList.remove('hinting');
  if (cells.length) clearHintClasses();
  hide(dom.hintCard);
}

function applyHint() {
  if (!currentHint) return;
  const h = currentHint;
  pushUndo();
  if (h.kind === 'place') {
    const [r, c] = h.targetCells[0];
    if (!game.queen[r][c]) {
      game.queen[r][c] = true;
      game.queenCount++;
      game.mark[r][c] = false;
      lastPlaced = { r, c };
    }
  } else if (h.kind === 'eliminate') {
    for (const [r, c] of h.targetCells) if (!game.queen[r][c]) game.mark[r][c] = true;
  } else if (h.kind === 'mistake') {
    const [r, c] = h.targetCells[0];
    if (game.queen[r][c]) {
      game.queen[r][c] = false;
      game.queenCount--;
    }
  }
  clearHint();
  updateBoard();
}

dom.hint.addEventListener('click', showHint);
dom.hintApply.addEventListener('click', applyHint);
dom.hintClose.addEventListener('click', clearHint);

// ---------- Debug ----------
function updateDebugButton() {
  dom.debugCopy.hidden = !settings.debug;
}

function cellList(pred) {
  const out = [];
  for (let r = 0; r < game.N; r++)
    for (let c = 0; c < game.N; c++) if (pred(r, c)) out.push([r, c]);
  return out;
}

// A compact ASCII board: region letters, [Q]ueen, . dot, · empty.
function asciiBoard() {
  const lines = [];
  for (let r = 0; r < game.N; r++) {
    let line = '';
    for (let c = 0; c < game.N; c++) {
      if (game.queen[r][c]) line += ' Q';
      else {
        const letter = String.fromCharCode(65 + game.region[r][c]);
        line += (game.mark[r][c] ? '.' : ' ') + letter;
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function buildDebugInfo() {
  const hint = computeHint(game.N, game.region, currentSolution, collectQueens(), game.mark);
  return {
    app: 'queens-debug/1',
    when: new Date().toISOString(),
    size: game.N,
    difficulty: settings.difficulty,
    quickMode: settings.quickMode,
    region: game.region,
    solution: currentSolution,
    queens: collectQueens(),
    marks: cellList((r, c) => game.mark[r][c]),
    conflicts: [...game.conflicts()].map((s) => s.split(',').map(Number)),
    won: game.isWon(),
    hint: {
      kind: hint.kind,
      title: hint.title,
      text: hint.text,
      targetCells: hint.targetCells || [],
      reasonCells: hint.reasonCells || [],
      excludedCells: hint.excludedCells || [],
    },
    board: asciiBoard(),
  };
}

async function copyDebug() {
  if (!game) return;
  const info = buildDebugInfo();
  const text = JSON.stringify(info, null, 2);
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (e) {
    // Fallback for browsers/contexts without the async clipboard API.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    document.body.removeChild(ta);
  }
  const label = dom.debugCopy.textContent;
  dom.debugCopy.textContent = ok ? '✓ Kopiert' : 'Kopieren fehlgeschlagen';
  setTimeout(() => (dom.debugCopy.textContent = label), 1500);
}

dom.debugCopy.addEventListener('click', copyDebug);
dom.debugMode.addEventListener('change', () => {
  settings.debug = dom.debugMode.checked;
  saveSettings(settings);
  updateDebugButton();
});

// ---------- Controls ----------
dom.newGame.addEventListener('click', newGame);
dom.winNewGame.addEventListener('click', newGame);
dom.undo.addEventListener('click', () => {
  clearHint();
  doUndo();
});
dom.resetBoard.addEventListener('click', () => {
  if (!game) return;
  clearHint();
  pushUndo();
  game.reset();
  hide(dom.winOverlay);
  startTimer(); // clear the board -> clean clock
  updateBoard();
});

// ---------- Settings modal ----------
dom.openSettings.addEventListener('click', openSettings);
dom.settingsClose.addEventListener('click', () => hide(dom.settingsOverlay));
dom.settingsOverlay.addEventListener('click', (e) => {
  if (e.target === dom.settingsOverlay) hide(dom.settingsOverlay);
});

function openSettings() {
  clearHint();
  dom.sizeRange.value = settings.size;
  dom.sizeValue.textContent = settings.size;
  setDifficultyUI(settings.difficulty);
  dom.quickMode.checked = settings.quickMode;
  dom.debugMode.checked = settings.debug;
  show(dom.settingsOverlay);
}

dom.sizeRange.addEventListener('input', () => {
  dom.sizeValue.textContent = dom.sizeRange.value;
});

dom.difficulty.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-value]');
  if (!btn) return;
  setDifficultyUI(btn.dataset.value);
});
function setDifficultyUI(value) {
  for (const btn of dom.difficulty.querySelectorAll('button')) {
    btn.setAttribute('aria-checked', String(btn.dataset.value === value));
  }
}
function currentDifficultyUI() {
  const active = dom.difficulty.querySelector('button[aria-checked="true"]');
  return active ? active.dataset.value : 'medium';
}

// Quick mode applies live to the running game (it doesn't change the puzzle).
dom.quickMode.addEventListener('change', () => {
  settings.quickMode = dom.quickMode.checked;
  saveSettings(settings);
  if (game) {
    game.setQuickMode(settings.quickMode);
    updateBoard();
  }
});

dom.settingsApply.addEventListener('click', () => {
  settings.size = clampSize(dom.sizeRange.value);
  settings.difficulty = currentDifficultyUI();
  settings.quickMode = dom.quickMode.checked;
  saveSettings(settings);
  hide(dom.settingsOverlay);
  newGame();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hide(dom.settingsOverlay);
    clearHint();
  }
});

// ---------- helpers ----------
function show(node) {
  node.hidden = false;
}
function hide(node) {
  node.hidden = true;
}

// ---------- boot ----------
updateDebugButton();
newGame();
