// main.js — wires the puzzle generator, game logic and DOM together.
import { generatePuzzle } from './generator.js';
import { drawLevel } from './levels.js';
import { Game } from './game.js';
import { computeHint } from './hint.js';
import { loadSettings, saveSettings, clampSize, sanitizeNickname } from './settings.js';
import {
  computeScore,
  sanitizeName,
  getLocalScores,
  saveLocalScore,
  previewRank,
} from './highscores.js';
import { leaderboardConfigured, submitScore, fetchTopScores } from './leaderboard.js';

// Distinct, mildly pastel region colours (supports up to 12 regions).
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
  check: el('check'),
  checkStatus: el('check-status'),
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
  partyOverlay: el('party-overlay'),
  confetti: el('confetti'),
  partyClose: el('party-close'),
  winOverlay: el('win-overlay'),
  winConfetti: el('win-confetti'),
  winTime: el('win-time'),
  winTabs: el('win-tabs'),
  winTabLocal: el('win-tab-local'),
  winTabGlobal: el('win-tab-global'),
  winScores: el('win-scores'),
  winNickname: el('win-nickname'),
  winSubmit: el('win-submit'),
  winSubmitStatus: el('win-submit-status'),
  winNewGame: el('win-new-game'),
  winSettings: el('win-settings'),
  openLeaderboard: el('open-leaderboard'),
  leaderboardOverlay: el('leaderboard-overlay'),
  lbSizeRange: el('lb-size-range'),
  lbSizeValue: el('lb-size-value'),
  lbDifficulty: el('lb-difficulty'),
  lbDifficultyHint: el('lb-difficulty-hint'),
  lbTabs: el('lb-tabs'),
  lbTabLocal: el('lb-tab-local'),
  lbTabGlobal: el('lb-tab-global'),
  lbScores: el('lb-scores'),
  lbClose: el('lb-close'),
  settingsOverlay: el('settings-overlay'),
  sizeRange: el('size-range'),
  sizeValue: el('size-value'),
  difficulty: el('difficulty'),
  difficultyHint: el('difficulty-hint'),
  quickMode: el('quick-mode'),
  liveCheck: el('live-check'),
  introAnimation: el('intro-animation'),
  settingsApply: el('settings-apply'),
  settingsClose: el('settings-close'),
};

let settings = loadSettings();
// Size 12 is hard-only (see applyDifficultyConstraint) — normalise a persisted
// or stale easy/medium choice so the first board matches what the modal allows.
if (settings.size >= 12) settings.difficulty = 'hard';
let game = null;
let currentSolution = null; // cols[r] of the unique solution (for hints)
let cells = []; // cells[r][c] -> HTMLElement
let colorMap = []; // color for each region id
let lastPlaced = null;
let hintActive = false;
let currentHint = null;

// Score inputs for the current attempt (reset with the clock in startTimer):
// hints revealed and queens placed off the unique solution. Both feed the win
// score (see js/highscores.js). onWin() runs once per solve, guarded by
// winHandled; pendingWin holds that result until it's committed to the local
// list (on submit, or when the board is left).
let hintsUsed = 0;
let mistakes = 0;
let winHandled = false;
let pendingWin = null; // { size, difficulty, seconds, hints, mistakes, score, saved }

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
  // Fresh clock for a new/reset board — also resets the score counters and the
  // win guard so the next solve is scored from scratch.
  untick();
  timerAccumMs = 0;
  timerRunStart = isWindowActive() ? Date.now() : 0;
  timerDone = false;
  hintsUsed = 0;
  mistakes = 0;
  winHandled = false;
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
// Generation is synchronous and can take several seconds on big/hard boards, so
// it runs in a module Web Worker to keep the main thread free for the intro
// animation. `genToken` guards against overlapping newGame() calls (e.g. the
// user hammering "Neues Spiel"): only the latest run is allowed to finish.
let genWorker = null;
let genToken = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function introEnabled() {
  return settings.introAnimation && !prefersReducedMotion();
}

// A fresh worker per request. Creating a new one implicitly terminates any
// in-flight (now-superseded) computation, so a stale board can't block a newer
// one. Returns null when module workers aren't available -> caller falls back to
// synchronous generation on the main thread.
function freshWorker() {
  if (genWorker) {
    genWorker.terminate();
    genWorker = null;
  }
  try {
    genWorker = new Worker(new URL('./generator.worker.js', import.meta.url), { type: 'module' });
  } catch (e) {
    genWorker = null;
  }
  return genWorker;
}

function generateAsync(N, difficulty, budgetMs) {
  return new Promise((resolve) => {
    const w = freshWorker();
    if (!w) {
      resolve(generatePuzzle(N, difficulty, { budgetMs }));
      return;
    }
    w.onmessage = (ev) => resolve(ev.data);
    w.onerror = () => {
      // Worker failed to load/import (older browser, etc.) -> generate inline.
      try {
        w.terminate();
      } catch (_) {}
      genWorker = null;
      resolve(generatePuzzle(N, difficulty, { budgetMs }));
    };
    w.postMessage({ N, difficulty, budgetMs });
  });
}

async function newGame() {
  flushPendingWin(); // record the last solve locally if it wasn't submitted
  const myToken = ++genToken;
  hide(dom.winOverlay);
  clearWinConfetti();
  dom.message.textContent = '';
  clearHint();
  clearCheckStatus();
  game = null; // block interaction (pointer/hint/undo all bail on !game) while loading
  untick();
  dom.timer.textContent = '0:00';

  const N = settings.size;
  const difficulty = settings.difficulty;
  const budgetMs = N >= 12 ? 5200 : N >= 11 ? 3800 : N >= 10 ? 2400 : N >= 8 ? 1400 : 900;
  const animate = introEnabled();

  if (animate) intro.startCompute(N);
  else show(dom.loading);

  // Precomputed pool first (instant, exact difficulty, randomly transformed);
  // live worker generation stays as the fallback when no pool is available.
  const puzzle = (await drawLevel(N, difficulty)) || (await generateAsync(N, difficulty, budgetMs));
  if (myToken !== genToken) return; // a newer newGame() superseded this one

  if (animate) {
    // Guarantee a beat of the compute animation even for instant (small) boards.
    const elapsed = intro.computeElapsed();
    if (elapsed < MIN_COMPUTE_MS) await wait(MIN_COMPUTE_MS - elapsed);
    if (myToken !== genToken) return;
  }

  buildBoard(N, puzzle.region, animate);
  if (animate) await intro.reveal(N);
  else hide(dom.loading);
  if (myToken !== genToken) return;

  game = new Game(N, puzzle.region, settings.quickMode);
  currentSolution = puzzle.solution;
  undoStack = [];
  updateActionButtons();
  updateBoard();
  startTimer(); // clock starts only once the board is playable, not during the intro
}

// ---------- Intro animation ----------
// Fills the generation wait with motion (worker keeps the main thread free) and
// then reveals the finished board: colour regions flood in from their centres
// while the board spins, easing back to 0deg — the orientation it was computed
// with. A single requestAnimationFrame loop drives both phases.
const MIN_COMPUTE_MS = 540; // minimum visible time for the "computing" bloom
const SPIN_SPEED = 32; // deg per second while generating
const ROT_EASE = 1.3; // seconds to unwind the rotation back to 0deg
const CELL_TRANS = 0.7; // must match the CSS opacity transition on revealed cells
const SCALE_MIN = 0.7; // ~1/√2: keeps the spinning square inside its own box

const intro = (() => {
  let raf = 0;
  let phase = 'idle'; // 'compute' | 'reveal' | 'idle'
  let placeholder = []; // { el, r, c } for the compute-phase bloom
  let computeStart = 0;
  let lastRot = 0; // current rotation angle, carried from compute into reveal
  let rotBase = 0;
  let rotTarget = 0;
  let revealStart = 0;
  let revealDuration = 0;
  let revealResolve = null;

  function ambientPaint(t) {
    // A slow travelling plasma across the placeholder grid: smooth waves of
    // pastel colour that read as the algorithm exploring the board.
    for (const pc of placeholder) {
      const v =
        Math.sin(pc.r * 0.7 + t * 1.6) +
        Math.cos(pc.c * 0.7 - t * 1.3) +
        Math.sin((pc.r + pc.c) * 0.45 + t * 0.9);
      const n = (v + 3) / 6; // 0..1
      const idx = Math.min(PALETTE.length - 1, Math.max(0, Math.floor(n * PALETTE.length)));
      pc.el.style.backgroundColor = PALETTE[idx];
      pc.el.style.opacity = (0.4 + 0.55 * n).toFixed(3);
    }
  }

  function frame(ts) {
    if (phase === 'compute') {
      const t = (ts - computeStart) / 1000;
      lastRot = t * SPIN_SPEED;
      dom.board.style.setProperty('--intro-rot', lastRot.toFixed(2) + 'deg');
      dom.board.style.setProperty('--intro-scale', SCALE_MIN);
      ambientPaint(t);
      raf = requestAnimationFrame(frame);
    } else if (phase === 'reveal') {
      const t = (ts - revealStart) / 1000;
      const k = Math.min(t / ROT_EASE, 1);
      const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      const rot = rotBase + (rotTarget - rotBase) * e;
      dom.board.style.setProperty('--intro-rot', (rot % 360).toFixed(2) + 'deg');
      dom.board.style.setProperty('--intro-scale', (SCALE_MIN + (1 - SCALE_MIN) * e).toFixed(4));
      if (t >= revealDuration) {
        dom.board.style.setProperty('--intro-rot', '0deg');
        dom.board.style.setProperty('--intro-scale', '1');
        dom.board.classList.remove('intro-revealing');
        phase = 'idle';
        raf = 0;
        const done = revealResolve;
        revealResolve = null;
        if (done) done();
      } else {
        raf = requestAnimationFrame(frame);
      }
    } else {
      raf = 0;
    }
  }

  function cancel() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    phase = 'idle';
    revealResolve = null;
  }

  return {
    computeElapsed() {
      return performance.now() - computeStart;
    },
    startCompute(N) {
      cancel();
      dom.board.classList.remove('intro-revealing');
      dom.board.style.setProperty('--n', N);
      dom.board.innerHTML = '';
      placeholder = [];
      cells = []; // no interactive cells during the compute phase
      const frag = document.createDocumentFragment();
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const d = document.createElement('div');
          d.className = 'cell intro-cell';
          placeholder.push({ el: d, r, c });
          frag.appendChild(d);
        }
      }
      dom.board.appendChild(frag);
      computeStart = performance.now();
      lastRot = 0;
      phase = 'compute';
      raf = requestAnimationFrame(frame);
    },
    // The real board must already be built (buildBoard with reveal=true), which
    // marks every cell .intro-hidden with its --reveal-delay. This unwinds the
    // rotation and drops .intro-hidden so the staggered fade-in flows.
    reveal() {
      return new Promise((resolve) => {
        rotBase = lastRot;
        rotTarget = Math.ceil((rotBase + 1e-6) / 360) * 360; // next 0deg, forward
        revealStart = performance.now();
        revealDuration = Math.max(ROT_EASE, revealMaxDelay + CELL_TRANS) + 0.17;
        revealResolve = resolve;
        phase = 'reveal';
        void dom.board.offsetWidth; // register the hidden state before releasing it
        for (const row of cells) for (const cell of row) cell.classList.remove('intro-hidden');
        if (!raf) raf = requestAnimationFrame(frame);
      });
    },
  };
})();

// Per-cell reveal delays: each region floods from its most interior cell (a
// distance-transform peak) outward, so no origin ever sits on a queen seed and
// the reveal leaks nothing. `revealMaxDelay` sizes the reveal phase.
let revealMaxDelay = 0;
const DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function regionRevealDelays(N, region) {
  const PER = 0.08; // seconds per ring outward from a region's centre
  const delays = Array.from({ length: N }, () => new Array(N).fill(0));
  const byReg = new Map();
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const g = region[r][c];
      if (!byReg.has(g)) byReg.set(g, []);
      byReg.get(g).push([r, c]);
    }

  let max = 0;
  for (const [g, group] of byReg) {
    const inReg = (r, c) => r >= 0 && r < N && c >= 0 && c < N && region[r][c] === g;

    // Depth from the region's border inward (multi-source BFS from border cells).
    const depth = new Map();
    const q = [];
    for (const [r, c] of group) {
      if (DIRS.some(([dr, dc]) => !inReg(r + dr, c + dc))) {
        depth.set(r + ',' + c, 0);
        q.push([r, c]);
      }
    }
    for (let h = 0; h < q.length; h++) {
      const [r, c] = q[h];
      const d = depth.get(r + ',' + c);
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (inReg(nr, nc) && !depth.has(nr + ',' + nc)) {
          depth.set(nr + ',' + nc, d + 1);
          q.push([nr, nc]);
        }
      }
    }

    // Origin = deepest (most interior) cell; never a border cell, never the seed.
    let origin = group[0];
    let best = -1;
    for (const [r, c] of group) {
      const d = depth.get(r + ',' + c);
      if (d > best) {
        best = d;
        origin = [r, c];
      }
    }

    // Distance from the origin -> per-cell delay.
    const dist = new Map();
    dist.set(origin[0] + ',' + origin[1], 0);
    const q2 = [origin];
    for (let h = 0; h < q2.length; h++) {
      const [r, c] = q2[h];
      const d = dist.get(r + ',' + c);
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (inReg(nr, nc) && !dist.has(nr + ',' + nc)) {
          dist.set(nr + ',' + nc, d + 1);
          q2.push([nr, nc]);
        }
      }
    }
    for (const [r, c] of group) {
      const del = (dist.get(r + ',' + c) || 0) * PER;
      delays[r][c] = del;
      if (del > max) max = del;
    }
  }
  revealMaxDelay = max;
  return delays;
}

function buildBoard(N, region, reveal = false) {
  // Assign a distinct palette colour per region.
  colorMap = shuffledPalette(N);
  dom.board.style.setProperty('--n', N);
  dom.board.classList.remove('intro-revealing');
  dom.board.style.setProperty('--intro-rot', '0deg');
  dom.board.innerHTML = '';
  cells = Array.from({ length: N }, () => new Array(N));

  // When revealing, each cell starts hidden and fades in on a per-cell delay so
  // the regions flood in from their centres.
  const delays = reveal ? regionRevealDelays(N, region) : null;

  const frag = document.createDocumentFragment();
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const div = document.createElement('div');
      div.className = 'cell';
      div.dataset.r = r;
      div.dataset.c = c;
      div.dataset.region = region[r][c];
      // Use background-COLOR (not the `background` shorthand) so a hint's
      // hatch (a background-image) can layer on top instead of being reset.
      div.style.backgroundColor = colorMap[region[r][c]];
      // Strong borders on region boundaries.
      if (r > 0 && region[r - 1][c] !== region[r][c]) div.classList.add('bt');
      if (r < N - 1 && region[r + 1][c] !== region[r][c]) div.classList.add('bb');
      if (c > 0 && region[r][c - 1] !== region[r][c]) div.classList.add('bl');
      if (c < N - 1 && region[r][c + 1] !== region[r][c]) div.classList.add('br');
      if (reveal) {
        div.classList.add('intro-hidden');
        div.style.setProperty('--reveal-delay', delays[r][c].toFixed(3) + 's');
      }
      frag.appendChild(div);
      cells[r][c] = div;
    }
  }
  dom.board.appendChild(frag);
  if (reveal) dom.board.classList.add('intro-revealing');
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
  const dead = game.deadUnits(auto);
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

      // Outline a unit in red once it's a dead end (fully dotted, no queen).
      // This covers colour regions as well as whole rows and columns. The red
      // edges are drawn only on a unit's outer sides — where it meets another
      // unit or the board edge — so each dead unit forms one clean border. A
      // cell may sit in several dead units at once; a side goes red if it's an
      // outer edge of any of them.
      const reg = region[r][c];
      const regDead = dead.regions.has(reg);
      const rowDead = dead.rows.has(r);
      const colDead = dead.cols.has(c);
      const isDead = regDead || rowDead || colDead;
      cell.classList.toggle('dead', isDead);
      cell.classList.toggle(
        'dt',
        (regDead && (r === 0 || region[r - 1][c] !== reg)) || rowDead || (colDead && r === 0)
      );
      cell.classList.toggle(
        'dr',
        (regDead && (c === N - 1 || region[r][c + 1] !== reg)) || colDead || (rowDead && c === N - 1)
      );
      cell.classList.toggle(
        'db',
        (regDead && (r === N - 1 || region[r + 1][c] !== reg)) || rowDead || (colDead && r === N - 1)
      );
      cell.classList.toggle(
        'dl',
        (regDead && (c === 0 || region[r][c - 1] !== reg)) || colDead || (rowDead && c === 0)
      );
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
  maybeParty();
  refreshLiveCheck();
  updateActionButtons(); // freeze undo/reset the instant the board is solved
}

function updateMessage() {
  if (game.isWon()) {
    // The win card below the board already says "Gelöst!", so keep the
    // in-board message line empty to avoid a redundant second announcement.
    dom.message.textContent = '';
    dom.message.className = 'message';
    onWin();
  } else if (game.queenCount === game.N) {
    dom.message.textContent = 'Fast! Es gibt noch Konflikte.';
    dom.message.className = 'message';
  } else {
    dom.message.textContent = '';
    dom.message.className = 'message';
  }
}

// ---------- Win / highscores ----------
let winTab = 'local'; // which list the win card shows: 'local' | 'global'

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
function setStatus(node, text, kind = '') {
  node.textContent = text;
  node.className = 'win-submit-status' + (kind ? ' ' + kind : '');
}

// Render score entries into a container. Names may come from other players via
// the global leaderboard, so they go in with textContent (never innerHTML) to
// keep untrusted text inert. highlightIdx (0-based) marks the player's own row.
function renderScoreList(container, entries, highlightIdx = -1) {
  container.innerHTML = '';
  if (!entries || entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'score-empty';
    empty.textContent = 'Noch keine Einträge – sei die/der Erste!';
    container.appendChild(empty);
    return;
  }
  entries.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'score-row' + (i === highlightIdx ? ' me' : '');
    row.title = `Zeit ${fmtTime(e.seconds)} · ${plural(e.hints, 'Tipp', 'Tipps')} · ${plural(
      e.mistakes,
      'Fehler',
      'Fehler'
    )}`;
    const rank = document.createElement('span');
    rank.className = 'score-rank';
    rank.textContent = `${i + 1}.`;
    const name = document.createElement('span');
    name.className = 'score-name';
    name.textContent = e.name || 'Anonym';
    const val = document.createElement('span');
    val.className = 'score-val';
    val.textContent = fmtTime(e.score);
    row.append(rank, name, val);
    container.appendChild(row);
  });
}

function onWin() {
  if (winHandled) return; // fire once per solve (updateBoard can re-run while won)
  winHandled = true;
  clearHint();
  stopTimer();

  const seconds = currentElapsed();
  const score = computeScore(seconds, hintsUsed, mistakes);
  pendingWin = {
    size: game.N,
    difficulty: settings.difficulty,
    seconds,
    hints: hintsUsed,
    mistakes,
    score,
    saved: false,
  };

  // Summary: the ranked "Ergebnis" (effective time) with the raw breakdown.
  dom.winTime.innerHTML =
    `<span class="win-score">${fmtTime(score)}</span>` +
    `<span class="win-breakdown">Zeit ${fmtTime(seconds)} · ${plural(
      hintsUsed,
      'Tipp',
      'Tipps'
    )} · ${plural(mistakes, 'Fehler', 'Fehler')}</span>`;

  dom.winNickname.value = settings.nickname || '';
  dom.winSubmit.disabled = false;
  dom.winSubmit.textContent = leaderboardConfigured() ? 'Eintragen' : 'Speichern';
  setStatus(dom.winSubmitStatus, '');
  dom.winTabs.hidden = !leaderboardConfigured();
  selectWinTab('local');

  show(dom.winOverlay);
  fireWinConfetti();
}

function selectWinTab(tab) {
  winTab = tab;
  dom.winTabLocal.setAttribute('aria-selected', String(tab === 'local'));
  dom.winTabGlobal.setAttribute('aria-selected', String(tab === 'global'));
  if (tab === 'local') renderWinLocal();
  else renderWinGlobal();
}

function renderWinLocal() {
  if (!pendingWin) return;
  const { size, difficulty } = pendingWin;
  if (pendingWin.saved) {
    renderScoreList(dom.winScores, getLocalScores(size, difficulty), pendingWin.savedRank);
    return;
  }
  // Not committed yet: preview where this solve would land in the local list.
  const list = getLocalScores(size, difficulty).slice();
  const rank = previewRank(size, difficulty, pendingWin.score);
  list.splice(rank, 0, {
    name: sanitizeNickname(dom.winNickname.value) || 'Du',
    seconds: pendingWin.seconds,
    hints: pendingWin.hints,
    mistakes: pendingWin.mistakes,
    score: pendingWin.score,
  });
  renderScoreList(dom.winScores, list.slice(0, 10), rank);
}

async function renderWinGlobal() {
  if (!pendingWin) return;
  renderScoreList(dom.winScores, [], -1);
  dom.winScores.firstChild.textContent = 'Lade globale Bestenliste …';
  const { size, difficulty } = pendingWin;
  const rows = await fetchTopScores(size, difficulty, 10);
  if (winTab !== 'global') return; // switched away while loading
  if (!rows) {
    renderScoreList(dom.winScores, [], -1);
    dom.winScores.firstChild.textContent = 'Globale Bestenliste nicht erreichbar.';
    return;
  }
  renderScoreList(dom.winScores, rows, -1);
}

// Persist the pending win to the on-device list exactly once.
function commitPendingWin(name) {
  if (!pendingWin || pendingWin.saved) return;
  const entryName = sanitizeName(name) || 'Anonym';
  const { rank } = saveLocalScore(pendingWin.size, pendingWin.difficulty, {
    name: entryName,
    seconds: pendingWin.seconds,
    hints: pendingWin.hints,
    mistakes: pendingWin.mistakes,
    score: pendingWin.score,
  });
  pendingWin.saved = true;
  pendingWin.savedRank = rank;
}

// Called when the board is left (new game / reset): record an un-submitted win
// locally with the remembered nickname so personal bests are never lost.
function flushPendingWin() {
  if (pendingWin && !pendingWin.saved) commitPendingWin(settings.nickname);
  pendingWin = null;
}

async function onWinSubmit() {
  if (!pendingWin) return;
  const typed = sanitizeNickname(dom.winNickname.value);
  if (typed) {
    settings.nickname = typed; // remember a real name for next time
    saveSettings(settings);
  }
  const name = typed || settings.nickname || 'Anonym';

  commitPendingWin(name); // always record locally first
  if (winTab === 'local') renderWinLocal();

  if (!leaderboardConfigured()) {
    dom.winSubmit.disabled = true;
    setStatus(dom.winSubmitStatus, 'Lokal gespeichert ✓', 'ok');
    return;
  }

  dom.winSubmit.disabled = true;
  setStatus(dom.winSubmitStatus, 'Sende an globale Bestenliste …');
  const res = await submitScore({
    name,
    size: pendingWin.size,
    difficulty: pendingWin.difficulty,
    seconds: pendingWin.seconds,
    hints: pendingWin.hints,
    mistakes: pendingWin.mistakes,
  });
  if (res && Number.isFinite(res.rank)) {
    setStatus(dom.winSubmitStatus, `Global eingetragen: Platz ${res.rank} von ${res.total} 🌐`, 'ok');
    selectWinTab('global');
  } else {
    setStatus(dom.winSubmitStatus, 'Global nicht erreichbar – lokal gespeichert ✓', 'err');
  }
}

// A short celebratory confetti burst on a win — same pieces as the party-mode
// Easter egg, but self-clearing after a few seconds so it doesn't linger over
// the solved board. Skipped under reduced-motion, like the party confetti.
let winConfettiTimer = null;
function fireWinConfetti() {
  clearWinConfetti();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  dom.winConfetti.appendChild(buildConfetti(80));
  show(dom.winConfetti);
  winConfettiTimer = setTimeout(clearWinConfetti, 4500);
}
function clearWinConfetti() {
  if (winConfettiTimer) clearTimeout(winConfettiTimer);
  winConfettiTimer = null;
  hide(dom.winConfetti);
  dom.winConfetti.innerHTML = '';
}

// ---------- Party mode (Easter egg) ----------
// Dotting every single cell (no queens anywhere) is a pointless, absurd thing
// to do — the whole board pulses red as one giant dead end. We reward the
// mischief: hold that state for 1.5s and a silent, no-audio party kicks off
// (confetti + alternating blue emergency lights + a mock achievement).
let partyTimer = null; // pending arm timer, or null
let partyActive = false; // overlay currently showing
let partyDone = false; // already partied for this fully-dotted episode

// Re-evaluated after every board change. Arms the party when the board becomes
// fully dotted, and tears everything down again the moment it isn't.
function maybeParty() {
  if (!game || !game.isFullyDotted()) {
    cancelPartyTimer();
    if (partyActive) stopParty();
    partyDone = false;
    return;
  }
  if (partyActive || partyDone || partyTimer) return;
  partyTimer = setTimeout(() => {
    partyTimer = null;
    startParty();
  }, 1500);
}

function cancelPartyTimer() {
  if (partyTimer) clearTimeout(partyTimer);
  partyTimer = null;
}

// Build N confetti pieces with randomised colour, size, drift, spin and timing.
function buildConfetti(n) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const piece = document.createElement('i');
    const size = 6 + Math.random() * 10;
    piece.style.left = (Math.random() * 100).toFixed(2) + 'vw';
    piece.style.width = size.toFixed(1) + 'px';
    piece.style.height = (size * (0.6 + Math.random() * 0.8)).toFixed(1) + 'px';
    piece.style.background = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    if (Math.random() < 0.3) piece.style.borderRadius = '50%';
    piece.style.setProperty('--x', (Math.random() * 160 - 80).toFixed(0) + 'px');
    piece.style.setProperty('--spin', (360 + Math.random() * 720).toFixed(0) + 'deg');
    piece.style.animationDuration = (2.4 + Math.random() * 2.6).toFixed(2) + 's';
    piece.style.animationDelay = (-Math.random() * 4).toFixed(2) + 's';
    frag.appendChild(piece);
  }
  return frag;
}

function startParty() {
  if (partyActive) return;
  partyActive = true;
  partyDone = true; // don't re-fire until the board leaves this state
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  dom.confetti.innerHTML = '';
  if (!reduce) dom.confetti.appendChild(buildConfetti(90));
  show(dom.partyOverlay);
}

function stopParty() {
  partyActive = false;
  hide(dom.partyOverlay);
  dom.confetti.innerHTML = '';
}

dom.partyClose.addEventListener('click', stopParty);
dom.partyOverlay.addEventListener('click', (e) => {
  if (e.target === dom.partyOverlay) stopParty();
});

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
  updateActionButtons();
}
// A solved board is frozen (see the isWon() guards on taps/hints): undo and
// reset are disabled too, so a recorded win can't be rewound into a second
// solve — nor the known board pointlessly cleared. The only way forward from a
// win is a new game.
function updateActionButtons() {
  const won = !!(game && game.isWon());
  dom.undo.disabled = won || undoStack.length === 0;
  dom.resetBoard.disabled = won;
}
function doUndo() {
  if (!game || game.isWon() || undoStack.length === 0) return;
  const s = undoStack.pop();
  game.mark = s.mark;
  game.queen = s.queen;
  game.queenCount = s.queenCount;
  lastPlaced = null;
  updateBoard();
  updateActionButtons();
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
  if (!game || hintActive || game.isWon()) return; // solved board is locked

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
    if (!wasQueen && game.queen[r][c]) {
      lastPlaced = { r, c };
      // A queen off the unique solution is a wrong deduction — count it once,
      // when placed (undoing it later doesn't un-count the misstep).
      if (currentSolution && currentSolution[r] !== c) mistakes++;
    }
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
  if (!game || hintActive || game.isWon()) return;
  hintsUsed++; // asking for help counts toward the score, even if not applied
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
    } else if (game.mark[r][c]) {
      game.mark[r][c] = false;
    }
  }
  clearHint();
  updateBoard();
}

dom.hint.addEventListener('click', showHint);
dom.hintApply.addEventListener('click', applyHint);
dom.hintClose.addEventListener('click', clearHint);

// ---------- Prüf-Status ----------
// A pure yes/no "is the board still error-free?" status — never a position and
// never the next move (that's the hint's job). It reads the same rule logic the
// board already uses (conflicts + dead units) plus a solution-aware check: a
// placed queen that isn't on the unique solution counts as an error even before
// a rule breaks (design choice (b)). Two ways to surface it:
//   - the "Prüfen" button: shows the status on demand,
//   - the live lamp (opt-in): updates automatically a short beat after the last
//     move, so it doesn't flicker while you're still placing queens.
const LIVE_CHECK_DELAY = 2000; // ms of quiet after the last move before the lamp updates
let liveCheckTimer = null;

function clearCheckStatus() {
  if (liveCheckTimer) {
    clearTimeout(liveCheckTimer);
    liveCheckTimer = null;
  }
  dom.checkStatus.hidden = true;
  dom.checkStatus.className = 'check-status';
  dom.checkStatus.textContent = '';
}

// Render the current yes/no result. Deliberately says nothing about *where*.
function renderCheckStatus() {
  if (!game) return;
  const error = game.hasError(currentSolution);
  dom.checkStatus.textContent = error ? '✗ Es gibt einen Fehler' : '✓ Keine Fehler';
  dom.checkStatus.className = 'check-status ' + (error ? 'error' : 'ok');
  dom.checkStatus.hidden = false;
}

// The "Prüfen" button: evaluate right away, regardless of the live setting.
function runCheck() {
  if (!game) return;
  if (liveCheckTimer) {
    clearTimeout(liveCheckTimer);
    liveCheckTimer = null;
  }
  renderCheckStatus();
}

// Called after every board change. Any current status is cleared immediately
// (the answer may no longer hold), and — when the live lamp is on — a fresh
// evaluation is armed for once the player pauses. Skipped on an untouched or
// solved board so the lamp stays quiet when there's nothing meaningful to say.
function refreshLiveCheck() {
  if (liveCheckTimer) {
    clearTimeout(liveCheckTimer);
    liveCheckTimer = null;
  }
  dom.checkStatus.hidden = true;
  dom.checkStatus.className = 'check-status';
  if (!settings.liveCheck || !game || game.isWon() || game.isPristine()) return;
  liveCheckTimer = setTimeout(renderCheckStatus, LIVE_CHECK_DELAY);
}

dom.check.addEventListener('click', runCheck);

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

// Pretty-print the debug JSON without exploding every number onto its own line.
// Arrays of primitives — and arrays of short primitive-arrays like coordinate
// pairs or a single region row — collapse onto one line when they fit;
// everything else still nests, so the structure stays scannable (e.g. the
// region prints as one line per row instead of one line per cell).
function formatDebug(value, indent = '') {
  const step = '  ';
  const isPrimitive = (v) => v === null || typeof v !== 'object';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const allPrim = value.every(isPrimitive);
    const allPrimArrays =
      !allPrim && value.every((v) => Array.isArray(v) && v.every(isPrimitive));
    if (allPrim || allPrimArrays) {
      const inline = '[' + value.map((v) => formatDebug(v)).join(', ') + ']';
      if (inline.length <= 100) return inline;
    }
    const inner = indent + step;
    return '[\n' + value.map((v) => inner + formatDebug(v, inner)).join(',\n') + '\n' + indent + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const inner = indent + step;
    return (
      '{\n' +
      keys.map((k) => inner + JSON.stringify(k) + ': ' + formatDebug(value[k], inner)).join(',\n') +
      '\n' + indent + '}'
    );
  }
  return JSON.stringify(value);
}

async function copyDebug() {
  if (!game) return;
  const info = buildDebugInfo();
  const text = formatDebug(info);
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
dom.winSettings.addEventListener('click', () => {
  hide(dom.winOverlay);
  clearWinConfetti();
  openSettings();
});
dom.winSubmit.addEventListener('click', onWinSubmit);
dom.winTabLocal.addEventListener('click', () => selectWinTab('local'));
dom.winTabGlobal.addEventListener('click', () => selectWinTab('global'));
dom.winNickname.addEventListener('input', () => {
  if (winTab === 'local' && pendingWin && !pendingWin.saved) renderWinLocal();
});
dom.undo.addEventListener('click', () => {
  clearHint();
  doUndo();
});
dom.resetBoard.addEventListener('click', () => {
  if (!game || game.isWon()) return; // a solved board is frozen — start a new game
  clearHint();
  pushUndo();
  game.reset();
  startTimer(); // clear the board -> clean clock
  updateBoard();
});

// ---------- Settings modal ----------
dom.openSettings.addEventListener('click', openSettings);
dom.settingsClose.addEventListener('click', closeSettings);
dom.settingsOverlay.addEventListener('click', (e) => {
  if (e.target === dom.settingsOverlay) closeSettings();
});

// Settings can be opened from the win card (its ⚙ button hides the card first).
// Closing settings without starting a new game must bring the win card back, so
// the solved board's score entry isn't stranded behind a frozen board.
function closeSettings() {
  hide(dom.settingsOverlay);
  if (game && game.isWon()) show(dom.winOverlay);
}

function openSettings() {
  clearHint();
  dom.sizeRange.value = settings.size;
  dom.sizeValue.textContent = settings.size;
  setDifficultyUI(settings.difficulty);
  applyDifficultyConstraint(settings.size);
  dom.quickMode.checked = settings.quickMode;
  dom.liveCheck.checked = settings.liveCheck;
  dom.introAnimation.checked = settings.introAnimation;
  dom.debugMode.checked = settings.debug;
  show(dom.settingsOverlay);
}

dom.sizeRange.addEventListener('input', () => {
  dom.sizeValue.textContent = dom.sizeRange.value;
  applyDifficultyConstraint(dom.sizeRange.value);
});

dom.difficulty.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-value]');
  if (!btn || btn.disabled) return;
  setDifficultyUI(btn.dataset.value);
});
function setDifficultyUI(value) {
  for (const btn of dom.difficulty.querySelectorAll('button')) {
    btn.setAttribute('aria-checked', String(btn.dataset.value === value));
  }
}
// A 12x12 board is inherently hard: puzzles solvable by the easy/medium
// techniques essentially don't exist at that size, so lock the choice to
// "Schwer" (and force it) whenever the slider sits at 12.
const HARD_ONLY_SIZE = 12;
function applyDifficultyConstraint(size) {
  const hardOnly = Number(size) >= HARD_ONLY_SIZE;
  for (const btn of dom.difficulty.querySelectorAll('button')) {
    btn.disabled = hardOnly && btn.dataset.value !== 'hard';
  }
  if (hardOnly) setDifficultyUI('hard');
  dom.difficultyHint.hidden = !hardOnly;
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

// Live-Prüfung applies to the running board at once: turning it on arms the
// lamp for the current position, turning it off hides it immediately.
dom.liveCheck.addEventListener('change', () => {
  settings.liveCheck = dom.liveCheck.checked;
  saveSettings(settings);
  if (settings.liveCheck) refreshLiveCheck();
  else clearCheckStatus();
});

// A visual-only preference: persist immediately so it sticks even if the modal
// is closed without applying. It takes effect on the next generated puzzle.
dom.introAnimation.addEventListener('change', () => {
  settings.introAnimation = dom.introAnimation.checked;
  saveSettings(settings);
});

dom.settingsApply.addEventListener('click', () => {
  settings.size = clampSize(dom.sizeRange.value);
  settings.difficulty = settings.size >= HARD_ONLY_SIZE ? 'hard' : currentDifficultyUI();
  settings.quickMode = dom.quickMode.checked;
  settings.liveCheck = dom.liveCheck.checked;
  settings.introAnimation = dom.introAnimation.checked;
  saveSettings(settings);
  hide(dom.settingsOverlay);
  newGame();
});

// ---------- Bestenliste modal ----------
// Browse best times for any (size, difficulty) bucket, on-device and — when the
// online leaderboard is configured — globally. Generic segmented-control
// helpers keep the size-12-is-hard-only rule consistent with the settings modal.
let lbTab = 'local';

function setSegmented(container, value) {
  for (const btn of container.querySelectorAll('button')) {
    btn.setAttribute('aria-checked', String(btn.dataset.value === value));
  }
}
function segmentedValue(container) {
  const active = container.querySelector('button[aria-checked="true"]');
  return active ? active.dataset.value : 'medium';
}
function applyHardOnly(container, hintEl, size) {
  const hardOnly = Number(size) >= HARD_ONLY_SIZE;
  for (const btn of container.querySelectorAll('button')) {
    btn.disabled = hardOnly && btn.dataset.value !== 'hard';
  }
  if (hardOnly) setSegmented(container, 'hard');
  if (hintEl) hintEl.hidden = !hardOnly;
}

function currentLbBucket() {
  const size = clampSize(dom.lbSizeRange.value);
  const difficulty = size >= HARD_ONLY_SIZE ? 'hard' : segmentedValue(dom.lbDifficulty);
  return { size, difficulty };
}

function openLeaderboard() {
  clearHint();
  const size = settings.size;
  const difficulty = size >= HARD_ONLY_SIZE ? 'hard' : settings.difficulty;
  dom.lbSizeRange.value = size;
  dom.lbSizeValue.textContent = size;
  setSegmented(dom.lbDifficulty, difficulty);
  applyHardOnly(dom.lbDifficulty, dom.lbDifficultyHint, size);
  dom.lbTabs.hidden = !leaderboardConfigured();
  selectLbTab('local');
  show(dom.leaderboardOverlay);
}

function selectLbTab(tab) {
  lbTab = tab;
  dom.lbTabLocal.setAttribute('aria-selected', String(tab === 'local'));
  dom.lbTabGlobal.setAttribute('aria-selected', String(tab === 'global'));
  renderLb();
}

async function renderLb() {
  const { size, difficulty } = currentLbBucket();
  if (lbTab !== 'global') {
    renderScoreList(dom.lbScores, getLocalScores(size, difficulty), -1);
    return;
  }
  renderScoreList(dom.lbScores, [], -1);
  dom.lbScores.firstChild.textContent = 'Lade globale Bestenliste …';
  const rows = await fetchTopScores(size, difficulty, 20);
  // Ignore a stale response if the tab or bucket changed while loading.
  const now = currentLbBucket();
  if (lbTab !== 'global' || now.size !== size || now.difficulty !== difficulty) return;
  if (!rows) {
    renderScoreList(dom.lbScores, [], -1);
    dom.lbScores.firstChild.textContent = 'Globale Bestenliste nicht erreichbar.';
    return;
  }
  renderScoreList(dom.lbScores, rows, -1);
}

dom.openLeaderboard.addEventListener('click', openLeaderboard);
dom.lbClose.addEventListener('click', () => hide(dom.leaderboardOverlay));
dom.leaderboardOverlay.addEventListener('click', (e) => {
  if (e.target === dom.leaderboardOverlay) hide(dom.leaderboardOverlay);
});
dom.lbSizeRange.addEventListener('input', () => {
  dom.lbSizeValue.textContent = dom.lbSizeRange.value;
  applyHardOnly(dom.lbDifficulty, dom.lbDifficultyHint, dom.lbSizeRange.value);
  renderLb();
});
dom.lbDifficulty.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-value]');
  if (!btn || btn.disabled) return;
  setSegmented(dom.lbDifficulty, btn.dataset.value);
  renderLb();
});
dom.lbTabLocal.addEventListener('click', () => selectLbTab('local'));
dom.lbTabGlobal.addEventListener('click', () => selectLbTab('global'));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!dom.settingsOverlay.hidden) closeSettings();
    hide(dom.leaderboardOverlay);
    clearHint();
    if (partyActive) stopParty();
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
