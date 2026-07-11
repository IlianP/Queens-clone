// main.js — wires the puzzle generator, game logic and DOM together.
import { generatePuzzle } from './generator.js';
import { Game } from './game.js';
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
  clearMarks: el('clear-marks'),
  resetBoard: el('reset-board'),
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
let cells = []; // cells[r][c] -> HTMLElement
let colorMap = []; // color for each region id
let lastPlaced = null;

// ---------- Timer ----------
let timerId = null;
let startTime = 0;
let elapsedFrozen = 0;

function startTimer() {
  stopTimer();
  startTime = Date.now();
  elapsedFrozen = 0;
  renderTime();
  timerId = setInterval(renderTime, 1000);
}
function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}
function currentElapsed() {
  return elapsedFrozen || Math.floor((Date.now() - startTime) / 1000);
}
function renderTime() {
  const s = currentElapsed();
  const m = Math.floor(s / 60);
  dom.timer.textContent = `${m}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- New game / generation ----------
function newGame() {
  hide(dom.winOverlay);
  dom.message.textContent = '';
  show(dom.loading);
  const N = settings.size;
  const difficulty = settings.difficulty;
  const budgetMs = N >= 11 ? 2600 : N >= 10 ? 2000 : N >= 8 ? 1300 : 800;

  // Yield a frame so the spinner paints before the (synchronous) generator runs.
  setTimeout(() => {
    const puzzle = generatePuzzle(N, difficulty, { budgetMs });
    buildBoard(N, puzzle.region);
    game = new Game(N, puzzle.region, settings.quickMode);
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
      div.style.background = colorMap[region[r][c]];
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
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = cells[r][c];
      const isConflict = conflicts.has(`${r},${c}`);
      cell.classList.toggle('conflict', isConflict);
      let html = '';
      if (game.queen[r][c]) html = CROWN;
      else if (game.mark[r][c]) html = '<span class="x">✕</span>';
      else if (auto[r][c]) html = '<span class="dot"></span>';
      if (cell.innerHTML !== html) cell.innerHTML = html;
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
  stopTimer();
  elapsedFrozen = currentElapsed();
  const m = Math.floor(elapsedFrozen / 60);
  const s = String(elapsedFrozen % 60).padStart(2, '0');
  dom.winTime.textContent = `Zeit: ${m}:${s}`;
  show(dom.winOverlay);
}

// ---------- Interaction ----------
dom.board.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || !game) return;
  const r = +cell.dataset.r;
  const c = +cell.dataset.c;
  const wasQueen = game.queen[r][c];
  game.tap(r, c);
  if (!wasQueen && game.queen[r][c]) lastPlaced = { r, c };
  updateBoard();
});

// ---------- Controls ----------
dom.newGame.addEventListener('click', newGame);
dom.winNewGame.addEventListener('click', newGame);
dom.clearMarks.addEventListener('click', () => {
  if (!game) return;
  game.clearMarks();
  updateBoard();
});
dom.resetBoard.addEventListener('click', () => {
  if (!game) return;
  game.reset();
  hide(dom.winOverlay);
  startTimer();
  updateBoard();
});

// ---------- Settings modal ----------
dom.openSettings.addEventListener('click', openSettings);
dom.settingsClose.addEventListener('click', () => hide(dom.settingsOverlay));
dom.settingsOverlay.addEventListener('click', (e) => {
  if (e.target === dom.settingsOverlay) hide(dom.settingsOverlay);
});

function openSettings() {
  dom.sizeRange.value = settings.size;
  dom.sizeValue.textContent = settings.size;
  setDifficultyUI(settings.difficulty);
  dom.quickMode.checked = settings.quickMode;
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
  if (e.key === 'Escape') hide(dom.settingsOverlay);
});

// ---------- helpers ----------
function show(node) {
  node.hidden = false;
}
function hide(node) {
  node.hidden = true;
}

// ---------- boot ----------
newGame();
