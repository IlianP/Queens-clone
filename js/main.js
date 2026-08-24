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
  recordSolve,
  getPersonalStats,
  globalPercentile,
  seedSolveHistory,
  matchOwnEntry,
  getSolveScores,
  MAX_SOLVE_HISTORY,
  MIN_SOLVES_FOR_PERCENTILE,
  MIN_GLOBAL_FOR_PERCENTILE,
  MIN_RECENT_SOLVES,
  MAX_LOCAL_ENTRIES,
  HINT_PENALTY,
  MISTAKE_PENALTY,
} from './highscores.js';
import { leaderboardConfigured, submitScore, fetchTopScores, fetchBucketCounts } from './leaderboard.js';
import {
  t,
  setLanguage,
  getLanguage,
  resolveLanguage,
  browserLanguages,
  I18N_LANGUAGES,
} from './i18n.js';
import {
  setMuted,
  playPlace,
  playDot,
  playErase,
  playHint,
  playUi,
  playWin,
  playParty,
} from './audio.js';
import {
  voiceSupported,
  createVoiceController,
  parseVoiceCommand,
  dedupeReplayCells,
  isRefinaliseExtension,
  coordLabel,
  colLetter,
  voiceSpeak,
  voiceSpeechSupported,
  voiceCancelSpeech,
} from './voice.js';

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
  boardStage: el('board-stage'),
  coordCols: el('coord-cols'),
  coordRows: el('coord-rows'),
  timer: el('timer'),
  message: el('message'),
  newGame: el('new-game'),
  openSettings: el('open-settings'),
  toggleSound: el('toggle-sound'),
  soundToggle: el('sound-toggle'),
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
  debugExtended: el('debug-extended'),
  debugExtendedField: el('debug-extended-field'),
  debugCopy: el('debug-copy'),
  loading: el('loading'),
  partyOverlay: el('party-overlay'),
  confetti: el('confetti'),
  partyClose: el('party-close'),
  winOverlay: el('win-overlay'),
  winClose: el('win-close'),
  winConfetti: el('win-confetti'),
  winTime: el('win-time'),
  winPersonal: el('win-personal'),
  winTabs: el('win-tabs'),
  winTabLocal: el('win-tab-local'),
  winTabGlobal: el('win-tab-global'),
  winScores: el('win-scores'),
  winNickname: el('win-nickname'),
  winSubmit: el('win-submit'),
  winSubmitStatus: el('win-submit-status'),
  winNewGame: el('win-new-game'),
  winDebugRow: el('win-debug-row'),
  winDebugCopy: el('win-debug-copy'),
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
  lbTabPeriod: el('lb-tab-period'),
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
  voiceMode: el('voice-mode'),
  voiceModeHint: el('voice-mode-hint'),
  voiceEdgeField: el('voice-edge-field'),
  voiceEdgeMode: el('voice-edge-mode'),
  settingsApply: el('settings-apply'),
  settingsClose: el('settings-close'),
  openQr: el('open-qr'),
  qrOverlay: el('qr-overlay'),
  qrClose: el('qr-close'),
  voicePanel: el('voice-panel'),
  voiceListen: el('voice-listen'),
  voiceListenLabel: el('voice-listen-label'),
  voiceTranscript: el('voice-transcript'),
  voiceStatus: el('voice-status'),
  voiceHelp: el('voice-help'),
  voiceHelpOverlay: el('voice-help-overlay'),
  voiceHelpClose: el('voice-help-close'),
  languageSelect: el('language-select'),
};

let settings = loadSettings();
// Pick the UI language before anything is rendered or any t() call runs: a
// stored choice wins, otherwise the browser decides, otherwise English (see
// resolveLanguage). Changing it later reloads the page, so this runs once.
setLanguage(resolveLanguage(settings.language, browserLanguages()));

// ---------- i18n ----------
// index.html ships the ENGLISH baseline inline (English is the default), and
// this swaps it for the resolved language before the first paint — the .app
// shell stays `visibility: hidden` until `data-i18n-ready` lands. It runs once
// per page: switching language reloads, so nothing is ever re-translated in
// place (see onLanguageChange).
//
//   data-i18n="key"                           -> textContent
//   data-i18n-html="key"                      -> innerHTML, for the few pack
//                                                values with inline markup.
//                                                NEVER for player/leaderboard text.
//   data-i18n-attr="aria-label:key|title:key" -> attributes
function applyTranslations(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll('[data-i18n-html]')) node.innerHTML = t(node.dataset.i18nHtml);
  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split('|')) {
      const sep = pair.indexOf(':');
      if (sep < 0) continue;
      node.setAttribute(pair.slice(0, sep).trim(), t(pair.slice(sep + 1).trim()));
    }
  }
  document.documentElement.lang = t('lang.htmlLang');
  document.documentElement.setAttribute('data-i18n-ready', '');
}

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
// Signatures of hints already counted this attempt. Re-requesting the exact same
// deduction (e.g. shown, dismissed unapplied, then asked for again on an
// unchanged board) must not bump hintsUsed a second time — only *unique* hints
// count toward the score (issue #37).
let seenHints = new Set();
let mistakes = 0;
let winHandled = false;
// pendingWin: { size, difficulty, seconds, hints, mistakes, score, saved,
//               submittedGlobal }. `submittedGlobal` latches true only after a
// confirmed online insert and is what stops the same solve being entered on the
// global board twice (the manual retry checks it).
let pendingWin = null;
let globalSubmitInFlight = false; // a submit (with its retries) is running
// Set only when opening settings *from* the win card (which hides it first) —
// closeSettings consumes it to decide whether to bring the card back. Left
// false when the card was already dismissed (✕ or a board tap) or settings
// was opened straight from the toolbar, so closing settings doesn't
// re-cover a board the player asked to see.
let winCardHiddenForSettings = false;

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
  seenHints = new Set();
  mistakes = 0;
  winHandled = false;
  stickyForced = null;
  resetJournal(); // fresh board → fresh move journal (coords refer to this board)
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

// The pools are mixed half organic / half blocky, so live generation — the
// fallback when a pool is missing — flips a coin too. Otherwise the rare board
// that misses the pool would always come back in the same look, which is exactly
// when a player would notice the inconsistency.
function randomStyle() {
  return Math.random() < 0.5 ? 'organic' : 'blocky';
}

function generateAsync(N, difficulty, budgetMs) {
  const style = randomStyle();
  return new Promise((resolve) => {
    const w = freshWorker();
    if (!w) {
      resolve(generatePuzzle(N, difficulty, { budgetMs, style }));
      return;
    }
    w.onmessage = (ev) => resolve(ev.data);
    w.onerror = () => {
      // Worker failed to load/import (older browser, etc.) -> generate inline.
      try {
        w.terminate();
      } catch (_) {}
      genWorker = null;
      resolve(generatePuzzle(N, difficulty, { budgetMs, style }));
    };
    w.postMessage({ N, difficulty, budgetMs, style });
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
  // The old board's voice chains can't correct anything on this one.
  lastVoiceReplayKeys = null;
  lastVoiceFill = null;
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
      buildCoordRulers(N); // keep the edge rulers in step with the new size
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

// Fill the edge rulers with N column letters (A…) and row numbers (1…). Cheap,
// so it's simply rebuilt whenever the board is (size can change per game). The
// rulers are only visible in Voice Mode's edge-label option, but building them
// unconditionally keeps the code path simple.
function buildCoordRulers(N) {
  dom.boardStage.style.setProperty('--n', N);
  const cf = document.createDocumentFragment();
  const rf = document.createDocumentFragment();
  for (let c = 0; c < N; c++) {
    const s = document.createElement('span');
    s.className = 'coord-label';
    s.textContent = colLetter(c);
    cf.appendChild(s);
  }
  for (let r = 0; r < N; r++) {
    const s = document.createElement('span');
    s.className = 'coord-label';
    s.textContent = String(r + 1);
    rf.appendChild(s);
  }
  dom.coordCols.innerHTML = '';
  dom.coordRows.innerHTML = '';
  dom.coordCols.appendChild(cf);
  dom.coordRows.appendChild(rf);
}

function buildBoard(N, region, reveal = false) {
  // Assign a distinct palette colour per region.
  colorMap = shuffledPalette(N);
  dom.board.style.setProperty('--n', N);
  dom.boardStage.style.setProperty('--n', N);
  buildCoordRulers(N);
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
      // Chess-style coordinate (e.g. "C4"); surfaced as a label only in Voice
      // Mode (.board.show-coords), but always stamped so it's ready on toggle.
      div.dataset.coord = coordLabel(r, c);
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
// How long the board waits before it paints error feedback (conflicts + dead
// units). Placement and dots stay instant; only the error marks are delayed so
// that an immediate row/column reaction can't betray a queen's position — the
// player gets a beat to reason before the board reacts. See scheduleErrorMarks.
const ERROR_MARK_DELAY = 500;
let errorMarkTimer = null;

function updateBoard() {
  const N = game.N;
  const auto = game.autoMarkGrid();
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
    }
  }

  // Error feedback (conflicts + dead units) is painted on a short delay. A
  // solved board has no errors to hide, so paint it at once to avoid a stale
  // red flash lingering under the win card.
  if (game.isWon()) renderErrorMarks();
  else scheduleErrorMarks();

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

// Paint (or clear) the board's error feedback from the live game state: red
// conflict cells plus the red outline around any dead unit. Reads current game
// state at call time, so it stays correct even when fired from a delayed timer.
function renderErrorMarks() {
  if (errorMarkTimer) {
    clearTimeout(errorMarkTimer);
    errorMarkTimer = null;
  }
  const N = game.N;
  const auto = game.autoMarkGrid();
  const conflicts = game.conflicts();
  const dead = game.deadUnits(auto);
  const region = game.region;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const cell = cells[r][c];
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
}

// Schedule the error feedback to appear after a short delay. Each board change
// resets the timer (debounce), so rapid taps only ever surface the errors of
// the settled position, never a fleeting mid-move reveal.
function scheduleErrorMarks() {
  if (errorMarkTimer) clearTimeout(errorMarkTimer);
  errorMarkTimer = setTimeout(() => {
    errorMarkTimer = null;
    if (game) renderErrorMarks();
  }, ERROR_MARK_DELAY);
}

function updateMessage() {
  if (game.isWon()) {
    // The win card below the board already says "Gelöst!", so keep the
    // in-board message line empty to avoid a redundant second announcement.
    dom.message.textContent = '';
    dom.message.className = 'message';
    onWin();
  } else if (game.queenCount === game.N) {
    dom.message.textContent = t('msg.almost');
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
// A gap between two results, phrased as a duration rather than a clock reading:
// "14 s" beats "0:14" for a difference.
function fmtDelta(sec) {
  const s = Math.max(0, Math.round(sec));
  return s < 60 ? t('time.seconds', { seconds: s }) : t('time.minutes', { time: fmtTime(s) });
}
function difficultyLabel(difficulty) {
  return t(`difficulty.${difficulty}`);
}
// Scores are ranked per (size, difficulty), so any comparison has to name the
// bucket it's about — otherwise "better than 88 %" reads as if it spanned every
// board size.
function bucketLabel(size, difficulty) {
  return t('bucket.label', { size, difficulty: difficultyLabel(difficulty) });
}
function setStatus(node, text, kind = '') {
  node.textContent = text;
  node.className = 'win-submit-status' + (kind ? ' ' + kind : '');
}

// When an entry was solved, in epoch ms, or null when unknown. The two lists
// carry it differently — the local one stores an ISO `date`, the global one
// sends `created_at`, parsed to `at` in leaderboard.js — and an un-migrated
// server sends nothing at all, which simply means no age is shown.
function entryTime(e) {
  const raw = e.at != null ? e.at : e.date ? Date.parse(e.date) : NaN;
  const at = Number(raw);
  return Number.isFinite(at) && at > 0 ? at : null;
}

// An age as { value, unit } for Intl.RelativeTimeFormat, which each language
// pack turns into words (see 'score.age'). The unit travels as a kind, the same
// way hint.js passes 'region' | 'row' | 'col' rather than a translated noun.
function ageParts(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return { value: sec, unit: 'second' };
  const min = Math.round(sec / 60);
  if (min < 60) return { value: min, unit: 'minute' };
  const hours = Math.round(min / 60);
  if (hours < 24) return { value: hours, unit: 'hour' };
  const days = Math.round(hours / 24);
  if (days < 31) return { value: days, unit: 'day' };
  const months = Math.round(days / 30.44);
  if (months < 12) return { value: months, unit: 'month' };
  return { value: Math.round(days / 365.25), unit: 'year' };
}

// Entries younger than this are called out in colour. A leaderboard without
// dates reads as frozen — this is the cheapest possible signal that someone
// else is actually playing, and it needs no second list and no ranking rules.
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

// Render score entries into a container. Names may come from other players via
// the global leaderboard, so they go in with textContent (never innerHTML) to
// keep untrusted text inert. highlightIdx (0-based) marks the player's own row.
function renderScoreList(container, entries, highlightIdx = -1) {
  container.innerHTML = '';
  if (!entries || entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'score-empty';
    empty.textContent = t('score.empty');
    container.appendChild(empty);
    return;
  }
  const now = Date.now();
  entries.forEach((e, i) => {
    const row = document.createElement('div');
    row.className = 'score-row' + (i === highlightIdx ? ' me' : '');
    const rowTitle = t('score.rowTitle', {
      time: fmtTime(e.seconds),
      hints: e.hints,
      mistakes: e.mistakes,
    });
    const at = entryTime(e);
    // The exact date goes in the tooltip, the rough age in the row: "vor 3
    // Tagen" is what a reader wants at a glance, the timestamp only on demand.
    row.title = at == null ? rowTitle : `${rowTitle} · ${t('score.rowDate', { at })}`;
    const rank = document.createElement('span');
    rank.className = 'score-rank';
    rank.textContent = `${i + 1}.`;
    const name = document.createElement('span');
    name.className = 'score-name';
    name.textContent = e.name || t('score.anonymous');
    const val = document.createElement('span');
    val.className = 'score-val';
    val.textContent = fmtTime(e.score);
    row.append(rank, name);
    if (at != null) {
      const age = document.createElement('span');
      age.className = 'score-age' + (now - at < FRESH_MS ? ' fresh' : '');
      age.textContent = t('score.age', ageParts(now - at));
      row.appendChild(age);
    }
    row.appendChild(val);
    container.appendChild(row);
  });
  scrollRowIntoView(container, highlightIdx);
}

// Bring the highlighted row into the list's scroll box, centred where possible.
// Necessary since the lists hold up to 50 entries: an own row at rank 34 would
// otherwise be marked somewhere outside the visible ~6 rows, i.e. invisibly.
// Deliberately NOT scrollIntoView() — that can scroll the page/board as well,
// and the card is a fixed overlay above it.
//
// Deferred by a frame because both callers render the list *before* revealing
// their card (onWin fills the tabs, then show()s the overlay). While it's still
// display:none every rect is zero and scrollTop silently stays 0, so measuring
// has to wait until it's laid out.
function scrollRowIntoView(container, idx) {
  if (idx < 0) return;
  const row = container.children[idx];
  if (!row) return;
  requestAnimationFrame(() => {
    // A re-render in the meantime replaces the rows — then this one is stale.
    if (row.parentElement !== container) return;
    const box = container.getBoundingClientRect();
    if (!box.height) return; // still hidden; nothing to measure against
    const r = row.getBoundingClientRect();
    container.scrollTop += r.top - box.top - (box.height - r.height) / 2;
  });
}

// Describe a fresh solve against the player's own previous ones. This is the
// feedback that works the moment the board is solved — no name, no network, no
// submit — which is why it lives in the win card itself rather than next to the
// global submit status. `stats` comes from getPersonalStats and is computed
// BEFORE this solve is recorded, so "deiner N bisherigen Partien" means the
// ones before this one.
function renderPersonalFeedback(stats, size, difficulty) {
  const box = dom.winPersonal;
  box.textContent = '';
  const label = bucketLabel(size, difficulty);
  // Distance to the personal best, or the fact that it was matched.
  const toBest =
    stats.delta == null || stats.delta === 0
      ? t('win.personal.toBest.equal')
      : t('win.personal.toBest.delta', { delta: fmtDelta(stats.delta) });
  let main = '';
  let detail = '';
  let isBest = false;

  if (stats.total === 0) {
    detail = t('win.personal.first', { bucket: label });
  } else if (stats.isBest) {
    isBest = true;
    main = t('win.personal.best');
    detail = t('win.personal.bestDetail', { delta: fmtDelta(stats.delta), bucket: label });
  } else if (stats.percentile == null || stats.percentile === 0) {
    // Either too few previous solves for a percentage to mean anything, or a
    // result that beat none of them — "better than 0 %" carries no information
    // the placement doesn't, and reads as a kick. The plain placement says the
    // same thing without the sneer.
    main = t('win.personal.rank', { rank: stats.rank, total: stats.total + 1 });
    detail = t('win.personal.detail', { bucket: label, toBest });
  } else {
    main = t('win.personal.percentile', {
      percent: stats.percentile,
      total: stats.total,
      capped: stats.capped,
    });
    detail = t('win.personal.detailRank', {
      rank: stats.rank,
      total: stats.total + 1,
      bucket: label,
      toBest,
    });
  }

  if (main) {
    const m = document.createElement('span');
    m.className = 'win-personal-main' + (isBest ? ' best' : '');
    m.textContent = main;
    box.appendChild(m);
  }
  if (detail) {
    const d = document.createElement('span');
    d.className = 'win-personal-detail';
    d.textContent = detail;
    box.appendChild(d);
  }
  const recentLine = recentFeedback(stats);
  if (recentLine) {
    const r = document.createElement('span');
    r.className = 'win-personal-window' + (stats.recent.isBest ? ' best' : '');
    r.textContent = recentLine;
    box.appendChild(r);
  }
}

// The time-scoped half of the personal feedback, or '' when there is nothing to
// say. getPersonalStats already withholds `recent` unless it adds something the
// all-time lines don't carry (too few solves in the window, or a window that
// covers the whole history), so this only has to pick the wording:
// current form as a record, as a percentage, or — where a percentage would be
// noise or a kick — as the plain placement.
function recentFeedback(stats) {
  const r = stats.recent;
  if (!r) return '';
  if (r.isBest) return t('win.personal.recentBest', { days: r.days });
  if (r.percentile == null || r.percentile === 0)
    return t('win.personal.recentRank', { rank: r.rank, total: r.total + 1, days: r.days });
  return t('win.personal.recentPercentile', {
    percent: r.percentile,
    total: r.total,
    days: r.days,
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
    at: Date.now(), // when it was solved — the preview row's age comes from this
    saved: false,
    submittedGlobal: false,
  };

  // Summary: the ranked result (effective time) with the raw breakdown.
  dom.winTime.textContent = '';
  const scoreEl = document.createElement('span');
  scoreEl.className = 'win-score';
  scoreEl.textContent = fmtTime(score);
  const breakdownEl = document.createElement('span');
  breakdownEl.className = 'win-breakdown';
  breakdownEl.textContent = t('win.breakdown', {
    time: fmtTime(seconds),
    hints: hintsUsed,
    mistakes,
  });
  dom.winTime.append(scoreEl, breakdownEl);

  // Compare against the history *before* this solve joins it (commitPendingWin
  // records it later), so the comparison set is "everything up to now". Kept on
  // pendingWin so the debug export can show exactly what the card was told.
  pendingWin.personal = getPersonalStats(game.N, settings.difficulty, score);
  renderPersonalFeedback(pendingWin.personal, game.N, settings.difficulty);

  dom.winNickname.value = settings.nickname || '';
  globalSubmitInFlight = false;
  dom.winSubmit.disabled = false;
  dom.winSubmit.textContent = leaderboardConfigured() ? t('win.submit') : t('win.save');
  setStatus(dom.winSubmitStatus, '');
  dom.winTabs.hidden = !leaderboardConfigured();
  selectWinTab('local');

  show(dom.winOverlay);
  fireWinConfetti();
  playWin();
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
  // The preview must land the row exactly where saving will put it (see
  // previewRank on why a tie goes behind), otherwise the list re-sorts itself
  // under the player's eyes the moment they press the button.
  const list = getLocalScores(size, difficulty).slice();
  const rank = previewRank(size, difficulty, pendingWin.score, pendingWin.seconds);
  list.splice(rank, 0, {
    name: sanitizeNickname(dom.winNickname.value) || t('score.you'),
    seconds: pendingWin.seconds,
    hints: pendingWin.hints,
    mistakes: pendingWin.mistakes,
    score: pendingWin.score,
    // Dated like every other row: the solve happened seconds ago, and a single
    // row without an age in an otherwise dated list reads as a missing value.
    date: new Date(pendingWin.at).toISOString(),
  });
  renderScoreList(dom.winScores, list.slice(0, MAX_LOCAL_ENTRIES), rank);
}

async function renderWinGlobal() {
  if (!pendingWin) return;
  renderScoreList(dom.winScores, [], -1);
  dom.winScores.firstChild.textContent = t('global.loading');
  const { size, difficulty } = pendingWin;
  const rows = await fetchTopScores(size, difficulty);
  if (winTab !== 'global') return; // switched away while loading
  if (!rows) {
    renderScoreList(dom.winScores, [], -1);
    dom.winScores.firstChild.textContent = t('global.unreachable');
    return;
  }
  // Mark the freshly submitted entry, like the local list does — but only once
  // it really is on the board. Before submitting, this list is other players'
  // data and the solve simply isn't in it, so nothing is highlighted; the status
  // line says why instead (see noteGlobalNotSubmitted).
  const mine = pendingWin.submittedGlobal
    ? matchOwnEntry(rows, {
        name: pendingWin.globalName,
        score: pendingWin.score,
        seconds: pendingWin.seconds,
        hints: pendingWin.hints,
        mistakes: pendingWin.mistakes,
      })
    : -1;
  renderScoreList(dom.winScores, rows, mine);
  if (!pendingWin.submittedGlobal) noteGlobalNotSubmitted();
}

// Explain the absence of your own result on the global tab before you've
// submitted it. This borrows the submit status line rather than adding a row or
// another paragraph: it's the line about exactly this, it's collapsed while
// empty, and reusing it keeps the win card from growing on a phone. Never
// overwrites a real message (a success, an error, a retry countdown).
function noteGlobalNotSubmitted() {
  if (dom.winSubmitStatus.textContent) return;
  setStatus(dom.winSubmitStatus, t('global.notSubmitted'));
}

// Persist the pending win to the on-device list exactly once. An unnamed entry
// is stored EMPTY on purpose: "Anonymous" is a UI word, and a stored one would
// stay frozen in whatever language it was written in — the lists render the
// placeholder at display time instead (see renderScoreList).
function commitPendingWin(name) {
  if (!pendingWin || pendingWin.saved) return;
  const entryName = sanitizeName(name);
  const { rank } = saveLocalScore(pendingWin.size, pendingWin.difficulty, {
    name: entryName,
    seconds: pendingWin.seconds,
    hints: pendingWin.hints,
    mistakes: pendingWin.mistakes,
    score: pendingWin.score,
    // Dated when it was SOLVED, not when it was saved: the win card may sit
    // open for minutes before the button is pressed, and everything time-scoped
    // (entry age, the 30-day window) should read the moment of the solve.
    date: new Date(pendingWin.at).toISOString(),
  });
  // Every solve also joins the history behind the percentile feedback — the
  // top list above drops everything past its cap, so it can't carry that.
  // This is the single funnel each finished game passes through (submit or
  // flushPendingWin), and `saved` guards it against counting a solve twice.
  recordSolve(pendingWin.size, pendingWin.difficulty, pendingWin.score, pendingWin.at);
  pendingWin.saved = true;
  pendingWin.savedRank = rank;
}

// Called when the board is left (new game / reset): record an un-submitted win
// locally with the remembered nickname so personal bests are never lost.
function flushPendingWin() {
  if (pendingWin && !pendingWin.saved) commitPendingWin(settings.nickname);
  pendingWin = null;
}

// Player-facing copy for a submit the server refused. `reason` is submit_score's
// own English message (see serverReason in leaderboard.js); anything unmapped is
// quoted verbatim rather than swallowed, so a new server-side check still tells
// the player something true. `allowRetry` is only for reasons that can pass later
// — the values themselves won't change on a second press.
const SUBMIT_REJECTIONS = {
  'implausible time': { key: 'submit.reject.implausibleTime', allowRetry: false },
  'bad counters': { key: 'submit.reject.badCounters', allowRetry: false },
  'bad size': { key: 'submit.reject.badSize', allowRetry: false },
  'bad difficulty': { key: 'submit.reject.badDifficulty', allowRetry: false },
  'rate limited': { key: 'submit.reject.rateLimited', allowRetry: true },
};
function rejectionCopy(reason) {
  const known = reason && SUBMIT_REJECTIONS[String(reason).trim().toLowerCase()];
  if (known) return { text: t(known.key), allowRetry: known.allowRetry };
  return {
    text: reason ? t('submit.reject.unknown', { reason }) : t('submit.reject.generic'),
    allowRetry: false,
  };
}

async function onWinSubmit() {
  if (!pendingWin) return;
  // Guard the two ways the same solve could be entered globally twice: a submit
  // already in flight, or one that has already succeeded. Either way, bail.
  if (globalSubmitInFlight || pendingWin.submittedGlobal) return;

  const typed = sanitizeNickname(dom.winNickname.value);
  if (typed) {
    settings.nickname = typed; // remember a real name for next time
    saveSettings(settings);
  }
  const name = typed || settings.nickname;

  commitPendingWin(name); // always record locally first (no-op if already saved)
  if (winTab === 'local') renderWinLocal();

  if (!leaderboardConfigured()) {
    dom.winSubmit.disabled = true;
    setStatus(dom.winSubmitStatus, t('submit.savedLocal'), 'ok');
    return;
  }

  globalSubmitInFlight = true;
  dom.winSubmit.disabled = true;
  setStatus(dom.winSubmitStatus, t('submit.sending'));
  const res = await submitScore(
    {
      name,
      size: pendingWin.size,
      difficulty: pendingWin.difficulty,
      seconds: pendingWin.seconds,
      hints: pendingWin.hints,
      mistakes: pendingWin.mistakes,
    },
    {
      onRetry: (attempt, total) =>
        setStatus(dom.winSubmitStatus, t('submit.retrying', { attempt, total })),
    }
  );
  globalSubmitInFlight = false;

  if (res && Number.isFinite(res.rank)) {
    pendingWin.submittedGlobal = true; // latch: this solve is now on the global board
    // Remember what was sent under which name and where it landed, so the global
    // tab can find and mark this exact row (see matchOwnEntry).
    pendingWin.globalName = sanitizeName(name);
    pendingWin.globalRank = res.rank;
    pendingWin.globalTotal = res.total;
    dom.winSubmit.disabled = true;
    // Placement plus, once the bucket is big enough to make it meaningful, the
    // share of entries beaten — "Platz 37" alone says little without knowing
    // how deep the field is.
    const pct = globalPercentile(res.rank, res.total);
    setStatus(
      dom.winSubmitStatus,
      pct == null
        ? t('submit.done', { rank: res.rank, total: res.total })
        : t('submit.donePercentile', { rank: res.rank, total: res.total, percent: pct }),
      'ok'
    );
    selectWinTab('global');
  } else if (res && res.rejected) {
    // The server answered and said no. Saying "nicht erreichbar" here sends the
    // player looking for a network problem that isn't there, so name the reason —
    // and only offer a retry where one can actually help (a rate limit passes,
    // rejected values never will).
    const { text, allowRetry } = rejectionCopy(res.reason);
    dom.winSubmit.disabled = !allowRetry;
    if (allowRetry) dom.winSubmit.textContent = t('win.retry');
    setStatus(dom.winSubmitStatus, t('submit.rejectedSaved', { text }), 'err');
    if (settings.debug) await copySubmitFailureDebug(res.attempts);
  } else {
    // The auto-retries didn't get through. Don't give up on a single episode:
    // keep the button live as a manual retry (it's re-labelled the first time).
    // This can't double-submit — submittedGlobal is still false, so it's the same
    // not-yet-recorded solve trying again; the moment one attempt succeeds it locks.
    dom.winSubmit.disabled = false;
    dom.winSubmit.textContent = t('win.retry');
    setStatus(dom.winSubmitStatus, t('submit.unreachable'), 'err');
    // Debug mode on: capture *why* it failed right now, while the diagnostics
    // are still available — no confirmation, no extra button, since asking
    // would just be one more thing lost if the player closes the screen.
    if (settings.debug) await copySubmitFailureDebug(res && res.attempts);
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
// mischief: hold that state for 1.5s and a party kicks off (confetti +
// alternating blue emergency lights + a mock achievement + a toy fanfare).
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
  playParty(); // gated only by mute, not reduced-motion (it's sound, not motion)
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
function doUndo(src, heard) {
  if (!game || game.isWon() || undoStack.length === 0) return;
  const before = journalEnabled() ? queenCoords() : null;
  const s = undoStack.pop();
  game.mark = s.mark;
  game.queen = s.queen;
  game.queenCount = s.queenCount;
  lastPlaced = null;
  updateBoard();
  updateActionButtons();
  if (before) {
    const after = queenCoords();
    const bset = new Set(before);
    const aset = new Set(after);
    journalPush({
      src: src || 'button',
      op: 'undo',
      heard,
      removed: before.filter((q) => !aset.has(q)),
      added: after.filter((q) => !bset.has(q)),
      queens: after,
    });
  }
}

// ---------- Interaction (tap + swipe) ----------
// A tap cycles a single cell. Press-and-drag paints: the first cell decides
// whether the stroke adds dots (started on an empty cell) or erases them
// (started on a marked cell); queens are never touched by a swipe.
//
// Two touch-accuracy safeguards ride on top of this (see also game.forcedCells):
//   1. Axis lock — once a swipe has swept far enough along a single row or
//      column, the stroke pins to that line for the rest of the gesture. A fast
//      finger drifting sideways near the end of a sweep can no longer dot a
//      stray neighbour: off-axis points are projected back onto the locked line.
//   2. Forced-cell target growth — when a unit has only one open cell left, the
//      queen there is obvious, so that cell's tap target grows a little into its
//      neighbours (see FORCED_TARGET_GROWTH) and a near-miss still lands on it.
//      See resolveTapCell.
let drag = null;

// How many cells a swipe must sweep along one line before the axis locks. Kept
// near the full row/column length (drift happens at the END of a long sweep, not
// on short strokes) but never below 3, so tiny boards don't lock over-eagerly.
function axisLockThreshold(N) {
  return Math.max(3, N - 2);
}

// How far a forced cell's tap target grows into each neighbour, as a fraction of
// the cell size. Kept small (20 %) on purpose: a bigger reach starts stealing
// taps that were genuinely meant for the neighbouring cell or region (marking or
// clearing there), so it only forgives a near-miss right at the shared edge.
const FORCED_TARGET_GROWTH = 0.2;

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

// ----- Forced-cell tap target growth (safeguard #2) -----
// A forced cell we just dotted, kept enlarged until it becomes a queen, so the
// whole two-tap "mark then crown" placement stays easy to hit even though the
// cell stops being "open" the moment its first dot lands.
let stickyForced = null;

// Would growing the target of forced cell (fr,fc) be ambiguous? It is when
// another forced cell sits in its 8-neighbourhood: their grown targets would
// overlap and fight over the same taps, so we leave both at natural size.
function forcedAmbiguous(fr, fc, forced) {
  for (const key of forced) {
    const [r, c] = key.split(',').map(Number);
    if (r === fr && c === fc) continue;
    if (Math.abs(r - fr) <= 1 && Math.abs(c - fc) <= 1) return true;
  }
  return false;
}

// Forced cells eligible for target growth right now: the unambiguous ones from
// game.forcedCells(), plus the sticky cell we dotted last tap (still a dot,
// awaiting its queen). Empty list ⇒ the feature is dormant and taps are raw.
function growableForcedCells() {
  const forced = game ? game.forcedCells() : new Set();
  const out = [];
  for (const key of forced) {
    const [r, c] = key.split(',').map(Number);
    if (forcedAmbiguous(r, c, forced)) continue;
    out.push({ r, c });
  }
  if (stickyForced) {
    const { r, c } = stickyForced;
    if (
      game.mark[r][c] &&
      !game.queen[r][c] &&
      !forcedAmbiguous(r, c, forced) &&
      !out.some((f) => f.r === r && f.c === c)
    ) {
      out.push({ r, c });
    }
  }
  return out;
}

// Resolve where a tap at (x,y) — nominally on cell (defR,defC) — should land.
// If a forced cell's grown target (its rect padded by half a cell) covers the
// point and the tapped cell is that forced cell or one of its neighbours, the
// tap is redirected there. Returns { r, c, grown }.
function resolveTapCell(x, y, defR, defC) {
  const targets = growableForcedCells();
  if (targets.length === 0) return { r: defR, c: defC, grown: false };
  // Tapping the forced cell itself — no redirect needed, but flag it so its
  // pending queen stays sticky.
  for (const f of targets) {
    if (f.r === defR && f.c === defC) return { r: f.r, c: f.c, grown: true };
  }
  let best = null;
  let bestDist = Infinity;
  for (const f of targets) {
    if (Math.abs(f.r - defR) > 1 || Math.abs(f.c - defC) > 1) continue; // neighbours only
    const rect = cells[f.r][f.c].getBoundingClientRect();
    // Grow the target by a fraction of a cell (see FORCED_TARGET_GROWTH), with
    // the outer edge EXCLUSIVE: only a near-miss right at the shared edge is
    // pulled in; a tap deeper into the neighbour stays with the neighbour.
    const padX = rect.width * FORCED_TARGET_GROWTH;
    const padY = rect.height * FORCED_TARGET_GROWTH;
    if (x <= rect.left - padX || x >= rect.right + padX) continue;
    if (y <= rect.top - padY || y >= rect.bottom + padY) continue;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = { r: f.r, c: f.c, grown: true };
    }
  }
  return best || { r: defR, c: defC, grown: false };
}

dom.board.addEventListener('pointerdown', (e) => {
  if (!game || hintActive) return;
  if (game.isWon()) {
    // Solved board is locked to input, but a tap still does something useful:
    // bring the win card back if it was dismissed to admire the board.
    if (dom.winOverlay.hidden) {
      playUi();
      show(dom.winOverlay);
    }
    return;
  }

  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const cell = e.target.closest('.cell');
  if (!cell) return;
  e.preventDefault();
  const startR = +cell.dataset.r;
  const startC = +cell.dataset.c;
  drag = {
    id: e.pointerId,
    startR,
    startC,
    mode: paintModeForStart(startR, startC),
    moved: false,
    snapshotted: false,
    lastKey: `${startR},${startC}`,
    lastSound: 0,
    // Down point, used to resolve a plain tap's grown target on release.
    downX: e.clientX,
    downY: e.clientY,
    // Axis-lock bookkeeping: the common row/column of every painted cell so far
    // (null once the stroke leaves it), and the locked axis once decided.
    rowConst: startR,
    colConst: startC,
    painted: 0,
    axis: null, // 'row' | 'col' once locked
    lockLine: -1,
  };
});

dom.board.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const cell = cellAtPoint(e.clientX, e.clientY);
  if (!cell) return;
  let r = +cell.dataset.r;
  let c = +cell.dataset.c;

  // Once locked, project the finger back onto the locked line: keep the moving
  // coordinate, pin the other, so drift off the axis marks the intended cell
  // rather than a stray neighbour.
  if (drag.axis === 'row') r = drag.lockLine;
  else if (drag.axis === 'col') c = drag.lockLine;

  const key = `${r},${c}`;
  if (key === drag.lastKey) return; // still on the last-processed cell
  drag.lastKey = key;

  // Track collinearity and lock the axis once the sweep is unmistakably a full
  // row or column. A diagonal/scribble drops both constraints and never locks.
  if (drag.axis === null) {
    if (drag.rowConst !== null && r !== drag.rowConst) drag.rowConst = null;
    if (drag.colConst !== null && c !== drag.colConst) drag.colConst = null;
    drag.painted++;
    if (drag.painted >= axisLockThreshold(game.N)) {
      if (drag.rowConst !== null && drag.colConst === null) {
        drag.axis = 'row';
        drag.lockLine = drag.rowConst;
      } else if (drag.colConst !== null && drag.rowConst === null) {
        drag.axis = 'col';
        drag.lockLine = drag.colConst;
      }
    }
  }

  let changed = false;
  if (!drag.moved) {
    drag.moved = true;
    changed = paintCell(drag.startR, drag.startC); // include the start cell
  }
  if (paintCell(r, c)) changed = true;
  if (changed) {
    updateBoard();
    // A soft tick as the stroke paints, throttled so a fast swipe stays a gentle
    // brush rather than a burst of clicks.
    const now = performance.now();
    if (now - drag.lastSound > 45) {
      drag.lastSound = now;
      if (drag.mode === 'mark') playDot();
      else playErase();
    }
  }
});

function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  if (!drag.moved) {
    // A plain tap: cycle the single cell (empty → dot → queen → empty). A tap on
    // (or near) a forced cell is redirected onto it via its grown target.
    const target = resolveTapCell(drag.downX, drag.downY, drag.startR, drag.startC);
    const { r, c } = target;
    pushUndo();
    const wasQueen = game.queen[r][c];
    const wasMark = game.mark[r][c];
    game.tap(r, c);
    if (!wasQueen && game.queen[r][c]) {
      lastPlaced = { r, c };
      playPlace();
      // A queen off the unique solution is a wrong deduction — count it once,
      // when placed (undoing it later doesn't un-count the misstep).
      if (currentSolution && currentSolution[r] !== c) mistakes++;
    } else if (!wasMark && game.mark[r][c]) {
      playDot();
    } else if ((wasQueen || wasMark) && !game.queen[r][c] && !game.mark[r][c]) {
      playErase();
    }
    // Keep a freshly-dotted forced cell enlarged until its queen lands, so the
    // second tap of the placement is just as forgiving as the first.
    stickyForced = target.grown && game.mark[r][c] && !game.queen[r][c] ? { r, c } : null;
    updateBoard();
    if (journalEnabled()) {
      let op = null;
      if (!wasQueen && game.queen[r][c]) op = `Dame ${coordLabel(r, c)}`;
      else if (!wasMark && game.mark[r][c]) op = `Punkt ${coordLabel(r, c)}`;
      else if ((wasQueen || wasMark) && !game.queen[r][c] && !game.mark[r][c]) op = `leer ${coordLabel(r, c)}`;
      if (op) journalPush({ src: 'tap', op, queens: queenCoords() });
    }
  } else if (drag.snapshotted && journalEnabled()) {
    // A press-and-drag paint stroke (dots only; queens are tap-only).
    journalPush({
      src: 'swipe',
      op: drag.mode === 'mark' ? 'Punkte (Wisch)' : 'löschen (Wisch)',
      queens: queenCoords(),
    });
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

// A stable identity for a hint, so the same deduction asked for twice is
// recognised as one. A hint is a pure function of the board, so identical advice
// carries the same target/reason/line/excluded cells — sort them so ordering
// never makes two equal hints look different.
function hintSignature(h) {
  if (!h || h.kind === 'none') return null;
  const sig = (arr) =>
    (arr || [])
      .map(([r, c]) => `${r},${c}`)
      .sort()
      .join(';');
  return [
    h.kind,
    sig(h.targetCells),
    sig(h.reasonCells),
    sig(h.lineCells),
    sig(h.excludedCells),
  ].join('|');
}

function showHint() {
  if (!game || hintActive || game.isWon()) return;
  playHint();
  const hint = computeHint(game.N, game.region, currentSolution, collectQueens(), game.mark);
  // Only count a hint once: re-requesting the same deduction (dismissed unapplied
  // then asked again on an unchanged board) must not penalise the score twice.
  const sig = hintSignature(hint);
  if (sig && !seenHints.has(sig)) {
    seenHints.add(sig);
    hintsUsed++; // asking for a new deduction counts, even if not applied
  }
  renderHint(hint);
}

// One legend chip: the colour swatch plus its label. Built as nodes rather than
// an HTML string so a translated label can never be read as markup.
function legendItem(swatchClass, key) {
  const chip = document.createElement('span');
  const swatch = document.createElement('i');
  swatch.className = swatchClass;
  chip.append(swatch, document.createTextNode(t(key)));
  return chip;
}

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

  dom.hintLegend.textContent = '';
  if (hint.reasonCells && hint.reasonCells.length)
    dom.hintLegend.appendChild(legendItem('lg-reason', 'legend.reason'));
  if (hint.kind === 'place') dom.hintLegend.appendChild(legendItem('lg-target', 'legend.target'));
  if (hint.kind === 'eliminate' || (hint.excludedCells && hint.excludedCells.length))
    dom.hintLegend.appendChild(legendItem('lg-x', 'legend.x'));

  dom.hintApply.hidden = !hint.applyLabel;
  if (hint.applyLabel) dom.hintApply.textContent = hint.applyLabel;
  show(dom.hintCard);

  // In a hands-free voice session, read the hint and its choices aloud.
  if (settings.voice && voiceListening) voiceSayHint(hint);
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
    playPlace();
  } else if (h.kind === 'eliminate') {
    for (const [r, c] of h.targetCells) if (!game.queen[r][c]) game.mark[r][c] = true;
    playDot();
  } else if (h.kind === 'mistake') {
    const [r, c] = h.targetCells[0];
    if (game.queen[r][c]) {
      game.queen[r][c] = false;
      game.queenCount--;
    } else if (game.mark[r][c]) {
      game.mark[r][c] = false;
    }
    playErase();
  }
  clearHint();
  updateBoard();
  if (journalEnabled()) {
    const opMap = { place: 'Hinweis: Dame', eliminate: 'Hinweis: Punkte', mistake: 'Hinweis: entfernen' };
    journalPush({ src: 'hint', op: opMap[h.kind] || 'Hinweis', queens: queenCoords() });
  }
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
  dom.checkStatus.textContent = error ? t('check.errors') : t('check.ok');
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

// Called after every board change. With the live lamp on, a red "there are
// errors" message is *sticky*: it stays put across taps and only clears once the
// board is actually error-free — so acknowledging an error doesn't make the
// warning vanish the instant you touch the board again. A green message is not
// sticky: like before, it's cleared on the next move and re-armed after a pause.
// Live off / untouched / solved: never keep a status around.
function refreshLiveCheck() {
  if (!settings.liveCheck || !game || game.isWon() || game.isPristine()) {
    clearCheckStatus();
    return;
  }

  // A red error already on screen stays exactly as it is while the board is
  // still in error — tapping a new cell must not clear it. Drop the pending
  // re-evaluation too; the answer ("there are errors") still holds.
  const showingError = !dom.checkStatus.hidden && dom.checkStatus.classList.contains('error');
  if (showingError && game.hasError(currentSolution)) {
    if (liveCheckTimer) {
      clearTimeout(liveCheckTimer);
      liveCheckTimer = null;
    }
    return;
  }

  // No sticky red to hold (nothing shown, a green shown, or the red's errors
  // just got cleared): hide the current status and re-arm a fresh evaluation
  // for once the player pauses.
  if (liveCheckTimer) {
    clearTimeout(liveCheckTimer);
    liveCheckTimer = null;
  }
  dom.checkStatus.hidden = true;
  dom.checkStatus.className = 'check-status';
  liveCheckTimer = setTimeout(renderCheckStatus, LIVE_CHECK_DELAY);
}

dom.check.addEventListener('click', () => {
  playUi();
  runCheck();
});

// ---------- Debug ----------
function updateDebugButton() {
  dom.debugCopy.hidden = !settings.debug;
  // Same state, second home: on the win card, where the scoring data is fresh.
  dom.winDebugRow.hidden = !settings.debug;
}

// The extended-debug sub-option only makes sense with Debug on, so it's shown in
// the settings modal only while the Debug switch is checked (mirrors how the edge
// coordinate option tracks the Voice Mode switch).
function updateDebugSubOptions() {
  dom.debugExtendedField.hidden = !dom.debugMode.checked;
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
  const info = {
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
  // Extended debug: the last 10 board-changing events, newest last. An 'undo'
  // entry lists exactly which queens it removed/re-added, so it's traceable what
  // "Rückgängig" undid. `t` is seconds on the clock; `n` is the running order.
  if (journalEnabled()) {
    info.app = 'queens-debug/2+journal';
    info.journal = moveJournal;
  }
  // A finished game carries its scoring with it: the raw components, the derived
  // score, and every input the relative feedback was computed from. Without this
  // a report of "the percentile line looks wrong" can't be checked — the board
  // state says nothing about the score stores (the gap that made the empty-history
  // bug hard to diagnose from an export).
  const result = buildResultDebug();
  if (result) info.result = result;
  return info;
}

// The scoring half of the debug state, or null while no game has been won. Kept
// separate so it can be attached to the win-card copy as well.
function buildResultDebug() {
  if (!pendingWin) return null;
  const { size, difficulty } = pendingWin;
  const history = getSolveScores(size, difficulty);
  const p = pendingWin.personal;
  return {
    bucket: `${size}-${difficulty}`,
    seconds: pendingWin.seconds,
    hints: pendingWin.hints,
    mistakes: pendingWin.mistakes,
    score: pendingWin.score,
    scoreFormula: `${pendingWin.seconds} + ${HINT_PENALTY}·${pendingWin.hints} + ${MISTAKE_PENALTY}·${pendingWin.mistakes}`,
    savedLocally: !!pendingWin.saved,
    savedRank: pendingWin.saved ? pendingWin.savedRank : null,
    // What the win card was told, computed before this solve joined the history.
    personal: p
      ? {
          previousSolves: p.total,
          rank: p.rank,
          percentile: p.percentile,
          percentileSuppressed: p.percentile == null,
          minSolvesForPercentile: MIN_SOLVES_FOR_PERCENTILE,
          isBest: p.isBest,
          bestScore: p.bestScore,
          delta: p.delta,
          historyAtCap: p.capped,
          maxHistory: MAX_SOLVE_HISTORY,
          // The rolling window behind the third feedback line. `datedSolves`
          // is the ceiling for it: solves recorded before timestamps existed
          // (or backfilled without a date) can never enter a window, so a
          // window smaller than expected is explained here rather than
          // looking like a bug.
          datedSolves: p.dated,
          recent: p.recent,
          minRecentSolves: MIN_RECENT_SOLVES,
        }
      : null,
    // The raw stores behind it, so the numbers above can be recomputed by hand.
    // `historyNow` includes this solve once it has been committed.
    historyNow: history,
    historyCount: history.length,
    localTop: getLocalScores(size, difficulty).map((e) => e.score),
    global: pendingWin.submittedGlobal
      ? {
          rank: pendingWin.globalRank,
          total: pendingWin.globalTotal,
          percentile: globalPercentile(pendingWin.globalRank, pendingWin.globalTotal),
          minTotalForPercentile: MIN_GLOBAL_FOR_PERCENTILE,
          name: pendingWin.globalName,
        }
      : null,
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

// Write text to the clipboard, falling back to a hidden textarea +
// execCommand for browsers/contexts without the async Clipboard API. Returns
// whether it worked. Shared by the manual "Kopieren" debug button and the
// automatic copy-on-submit-failure below.
async function writeToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }
}

// Copy the debug state and confirm on the button that triggered it — either the
// one in the settings or the one on the win card.
async function copyDebug(btn = dom.debugCopy) {
  if (!game) return;
  const ok = await writeToClipboard(formatDebug(buildDebugInfo()));
  const label = btn.textContent;
  btn.textContent = ok ? t('debug.copied') : t('debug.copyFailed');
  setTimeout(() => (btn.textContent = label), 1500);
}

// When a global score submit fails and Debug mode is on, copy the full debug
// state plus the submit diagnostics (HTTP status / error per retry attempt,
// from leaderboard.js) to the clipboard right away — no confirmation, no
// extra button — so a report of "why wasn't it reachable" (client-side vs.
// the provider) doesn't depend on reproducing the failure later.
async function copySubmitFailureDebug(attempts) {
  if (!game) return;
  const info = buildDebugInfo();
  info.submitFailure = { when: new Date().toISOString(), attempts: attempts || [] };
  const ok = await writeToClipboard(formatDebug(info));
  if (ok) dom.winSubmitStatus.textContent += t('debug.copiedSuffix');
}

dom.debugCopy.addEventListener('click', () => copyDebug(dom.debugCopy));
dom.winDebugCopy.addEventListener('click', () => copyDebug(dom.winDebugCopy));
dom.debugMode.addEventListener('change', () => {
  settings.debug = dom.debugMode.checked;
  saveSettings(settings);
  updateDebugButton();
  updateDebugSubOptions();
});
dom.debugExtended.addEventListener('change', () => {
  settings.debugExtended = dom.debugExtended.checked;
  saveSettings(settings);
  if (settings.debugExtended) resetJournal(); // start a clean recording
});

// ---------- Controls ----------
dom.newGame.addEventListener('click', () => {
  playUi();
  newGame();
});
dom.winNewGame.addEventListener('click', () => {
  playUi();
  newGame();
});
dom.winSettings.addEventListener('click', () => {
  playUi();
  winCardHiddenForSettings = true;
  hide(dom.winOverlay);
  clearWinConfetti();
  openSettings();
});
// Dismiss the card without discarding the win: pendingWin is untouched, so the
// result is still there to submit (or gets flushed to the local list normally)
// once the player reopens it — see the pointerdown handler on the board below.
dom.winClose.addEventListener('click', () => {
  playUi();
  hide(dom.winOverlay);
  clearWinConfetti();
});
dom.winSubmit.addEventListener('click', onWinSubmit);
dom.winTabLocal.addEventListener('click', () => selectWinTab('local'));
dom.winTabGlobal.addEventListener('click', () => selectWinTab('global'));
dom.winNickname.addEventListener('input', () => {
  if (winTab === 'local' && pendingWin && !pendingWin.saved) renderWinLocal();
});
dom.undo.addEventListener('click', () => {
  playUi();
  clearHint();
  doUndo();
});
dom.resetBoard.addEventListener('click', () => {
  if (!game || game.isWon()) return; // a solved board is frozen — start a new game
  playUi();
  clearHint();
  pushUndo();
  game.reset();
  startTimer(); // clear the board -> clean clock (clears the journal too)
  updateBoard();
  if (journalEnabled()) journalPush({ src: 'button', op: 'reset', queens: [] });
});

// ---------- Settings modal ----------
dom.openSettings.addEventListener('click', () => {
  playUi();
  openSettings();
});
dom.settingsClose.addEventListener('click', closeSettings);
dom.settingsOverlay.addEventListener('click', (e) => {
  if (e.target === dom.settingsOverlay) closeSettings();
});

// ---------- Share (QR) ----------
// Handing the game to someone standing next to you: the code is fixed markup in
// index.html (no generator ships with the app), so this is only open/close. It
// layers ON TOP of the settings — they stay open behind it, and closing the code
// lands back there.
dom.openQr.addEventListener('click', () => {
  playUi();
  show(dom.qrOverlay);
});
dom.qrClose.addEventListener('click', () => hide(dom.qrOverlay));
dom.qrOverlay.addEventListener('click', (e) => {
  if (e.target === dom.qrOverlay) hide(dom.qrOverlay);
});

// Settings can be opened from the win card (its ⚙ button hides the card first).
// Closing settings without starting a new game must bring the win card back, so
// the solved board's score entry isn't stranded behind a frozen board.
function closeSettings() {
  hide(dom.qrOverlay);
  hide(dom.settingsOverlay);
  if (winCardHiddenForSettings && game && game.isWon()) show(dom.winOverlay);
  winCardHiddenForSettings = false;
}

function openSettings() {
  clearHint();
  dom.languageSelect.value = settings.language;
  dom.sizeRange.value = settings.size;
  dom.sizeValue.textContent = settings.size;
  setDifficultyUI(settings.difficulty);
  applyDifficultyConstraint(settings.size);
  dom.quickMode.checked = settings.quickMode;
  dom.liveCheck.checked = settings.liveCheck;
  dom.introAnimation.checked = settings.introAnimation;
  dom.soundToggle.checked = settings.sound;
  dom.voiceMode.checked = settings.voice;
  dom.voiceEdgeMode.checked = settings.voiceEdgeLabels;
  updateVoiceSubOptions();
  dom.debugMode.checked = settings.debug;
  dom.debugExtended.checked = settings.debugExtended;
  updateDebugSubOptions();
  show(dom.settingsOverlay);
}

// ---------- Language ----------
// Options are endonyms ("Deutsch", never "German"), so a language is always
// listed in itself — someone who landed in the wrong language can still find
// their own. The leading "automatic" entry is the default and IS translated.
function populateLanguageSelect() {
  for (const { code, name } of I18N_LANGUAGES) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = name;
    dom.languageSelect.appendChild(opt);
  }
  dom.languageSelect.value = settings.language;
}

// Switching language reloads the page instead of re-translating in place. Not
// for speed — swapping the labels is cheap — but because everything transient
// would have to be re-localised too: an open hint card, the win screen, the
// score lists, and the recogniser, which has to restart on a new `lang` anyway.
// One code path, no half-translated corner.
function onLanguageChange() {
  const chosen = dom.languageSelect.value;
  if (chosen === settings.language) return;
  const resolved = resolveLanguage(chosen, browserLanguages());
  // The resolved language can be unchanged even though the setting changed
  // ("automatic" on a German browser is still German) — then there is nothing
  // to reload for, and nothing to warn about.
  if (resolved === getLanguage()) {
    settings.language = chosen;
    saveSettings(settings);
    return;
  }
  // A reload always discards the board: this project persists preferences, never
  // game state. So ask first if there is a game worth losing.
  const inProgress = game && !game.isPristine() && !game.isWon();
  if (inProgress && !window.confirm(t('settings.language.confirm'))) {
    dom.languageSelect.value = settings.language; // put the picker back
    return;
  }
  settings.language = chosen;
  saveSettings(settings);
  flushPendingWin(); // a solved-but-unsubmitted game still reaches the local list
  location.reload();
}
dom.languageSelect.addEventListener('change', onLanguageChange);

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
  settings.voice = dom.voiceMode.checked;
  settings.voiceEdgeLabels = dom.voiceEdgeMode.checked;
  saveSettings(settings);
  applyVoiceSetting();
  hide(dom.settingsOverlay);
  newGame();
});

// ---------- Bestenliste modal ----------
// Browse best times for any (size, difficulty) bucket, on-device and — when the
// online leaderboard is configured — globally. Generic segmented-control
// helpers keep the size-12-is-hard-only rule consistent with the settings modal.
let lbTab = 'local';

// The time-scoped global view. Rolling days rather than a calendar month: a
// month is empty on the 1st and full on the 28th, so the same result would read
// completely differently depending on the date — and this game's buckets are far
// too thin to survive that. 90 days is one constant; widen or narrow it here.
const PERIOD_DAYS = 90;
const PERIOD_MS = PERIOD_DAYS * 24 * 60 * 60 * 1000;
// Below this many entries inside the window there is no field to rank, so the
// tab is not offered at all. A leaderboard of three is worse than none: it
// promises a comparison it cannot make.
const MIN_PERIOD_ENTRIES = 5;
// Bucket key → { total, recent } from score_counts, or null when the server
// can't answer (offline, or SQL not re-run — see fetchBucketCounts). Cached for
// the session: it decides tab visibility, not the list contents, so it may be a
// few minutes stale.
const periodCounts = new Map();

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
  // The label carries the window length, so it is built here rather than in the
  // markup — one constant, four languages, no hard-coded "90" anywhere.
  dom.lbTabPeriod.textContent = t('win.tab.period', { days: PERIOD_DAYS });
  dom.lbTabPeriod.title = t('win.tab.periodAria', { days: PERIOD_DAYS });
  dom.lbTabPeriod.setAttribute('aria-label', t('win.tab.periodAria', { days: PERIOD_DAYS }));
  selectLbTab('local');
  show(dom.leaderboardOverlay);
  refreshPeriodTab();
}

function selectLbTab(tab) {
  lbTab = tab;
  dom.lbTabLocal.setAttribute('aria-selected', String(tab === 'local'));
  dom.lbTabGlobal.setAttribute('aria-selected', String(tab === 'global'));
  dom.lbTabPeriod.setAttribute('aria-selected', String(tab === 'period'));
  renderLb();
}

// Is the window worth its own tab in this bucket? Two ways to say no, and both
// matter: too few entries inside it to rank at all, and — the mirror image — a
// bucket whose entries are ALL inside it, where the tab would just be a second
// copy of the global list under a different name.
function periodOffered(counts) {
  return !!counts && counts.recent >= MIN_PERIOD_ENTRIES && counts.recent < counts.total;
}

// Decide whether to show the period tab for the bucket now selected. Fails
// closed: while the answer is unknown — still loading, offline, or a database
// where the SQL hasn't been re-run — the tab stays hidden and the modal behaves
// exactly as it did before this feature.
async function refreshPeriodTab() {
  const { size, difficulty } = currentLbBucket();
  const key = `${size}-${difficulty}`;
  if (!leaderboardConfigured()) return hidePeriodTab();
  if (!periodCounts.has(key)) {
    hidePeriodTab();
    const counts = await fetchBucketCounts(size, difficulty, Date.now() - PERIOD_MS);
    periodCounts.set(key, counts);
    // The player may have moved the size slider while that was in flight; the
    // answer is cached either way, but it isn't about the visible bucket.
    const now = currentLbBucket();
    if (now.size !== size || now.difficulty !== difficulty) return;
  }
  if (periodOffered(periodCounts.get(key))) dom.lbTabPeriod.hidden = false;
  else hidePeriodTab();
}

function hidePeriodTab() {
  dom.lbTabPeriod.hidden = true;
  if (lbTab === 'period') selectLbTab('global'); // never strand the view on a gone tab
}

async function renderLb() {
  const { size, difficulty } = currentLbBucket();
  if (lbTab === 'local') {
    renderScoreList(dom.lbScores, getLocalScores(size, difficulty), -1);
    return;
  }
  const since = lbTab === 'period' ? Date.now() - PERIOD_MS : null;
  const tab = lbTab;
  renderScoreList(dom.lbScores, [], -1);
  dom.lbScores.firstChild.textContent = t('global.loading');
  const rows = await fetchTopScores(size, difficulty, { since });
  // Ignore a stale response if the tab or bucket changed while loading.
  const now = currentLbBucket();
  if (lbTab !== tab || now.size !== size || now.difficulty !== difficulty) return;
  if (!rows) {
    renderScoreList(dom.lbScores, [], -1);
    dom.lbScores.firstChild.textContent = t('global.unreachable');
    return;
  }
  renderScoreList(dom.lbScores, rows, -1);
}

dom.openLeaderboard.addEventListener('click', () => {
  playUi();
  openLeaderboard();
});
dom.lbClose.addEventListener('click', () => hide(dom.leaderboardOverlay));
dom.leaderboardOverlay.addEventListener('click', (e) => {
  if (e.target === dom.leaderboardOverlay) hide(dom.leaderboardOverlay);
});
dom.lbSizeRange.addEventListener('input', () => {
  dom.lbSizeValue.textContent = dom.lbSizeRange.value;
  applyHardOnly(dom.lbDifficulty, dom.lbDifficultyHint, dom.lbSizeRange.value);
  renderLb();
  refreshPeriodTab(); // another bucket, another answer to "is there a field?"
});
dom.lbDifficulty.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-value]');
  if (!btn || btn.disabled) return;
  setSegmented(dom.lbDifficulty, btn.dataset.value);
  renderLb();
  refreshPeriodTab();
});
dom.lbTabLocal.addEventListener('click', () => selectLbTab('local'));
dom.lbTabGlobal.addEventListener('click', () => selectLbTab('global'));
dom.lbTabPeriod.addEventListener('click', () => selectLbTab('period'));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // The QR code layers over the settings, so it takes Escape first —
    // otherwise one key would close both and drop the player back at the board.
    if (!dom.qrOverlay.hidden) {
      hide(dom.qrOverlay);
      return;
    }
    if (!dom.settingsOverlay.hidden) closeSettings();
    hide(dom.leaderboardOverlay);
    hide(dom.voiceHelpOverlay);
    clearHint();
    if (partyActive) stopParty();
  }
});

// ---------- Sound ----------
// One preference (`sound`) drives both the topbar speaker button and the
// settings toggle; they stay in sync via applySoundSetting(). The audio layer is
// muted by flipping a flag, so nothing plays while off and no context is created.
function applySoundSetting() {
  setMuted(!settings.sound);
  const on = settings.sound;
  dom.toggleSound.textContent = on ? '🔊' : '🔇';
  dom.toggleSound.setAttribute('aria-pressed', String(!on)); // pressed = muted
  dom.toggleSound.setAttribute('aria-label', on ? t('ui.sound.mute') : t('ui.sound.unmute'));
  dom.toggleSound.title = on ? t('ui.sound.on') : t('ui.sound.off');
  dom.soundToggle.checked = on;
}

function setSound(on) {
  settings.sound = !!on;
  saveSettings(settings);
  applySoundSetting();
  if (settings.sound) playUi(); // a little blip confirms it, only when turning on
}

dom.toggleSound.addEventListener('click', () => setSound(!settings.sound));
dom.soundToggle.addEventListener('change', () => setSound(dom.soundToggle.checked));

// ---------- Voice Mode ----------
// Steer the board by speaking (Beta). The recogniser (js/voice.js) only emits
// raw text; parseVoiceCommand turns it into a structured command, and here we
// route that command into the SAME internal calls a tap or a button would make
// — no duplicate game logic. Coordinates are chess-like: a column letter + a row
// number ("C4"), surfaced as per-cell labels while Voice Mode is on.
let voiceController = null;
let voiceListening = false; // reflects the recogniser state (for TTS gating)
let voiceSpeaking = false; // true while reading a hint aloud — suppress commands
// Replay guard for re-finalised recognition segments (see dedupeReplayCells):
// the "r,c,action" keys of the last voice coordinate command, and when it ran.
let lastVoiceReplayKeys = null;
let lastVoiceReplayAt = 0;
const VOICE_REPLAY_MS = 1500; // a re-finalise lands ~1s later; keep the window tight
// Correction guard for re-finalised FILLS (see the fill branch in
// handleVoiceCommand). A fill can't be fixed by re-running a narrower one —
// marking only adds — so a cut-short fill has to be rolled back and replaced.
// `snap` is the exact undo snapshot that fill pushed (identity-checked against
// the stack top, so any interleaved move disqualifies the rollback), or null
// when there is nothing to roll back.
let lastVoiceFill = null; // { text, at, snap }

const VOICE_ACTION_LABEL = {
  toggle: 'umgeschaltet',
  queen: 'Dame gesetzt',
  mark: 'Punkt',
  clear: 'geleert',
};

// Canonical colour key (from voice.js) → the palette colour it names. Kept in
// sync with PALETTE; the parser only knows colour words, main.js owns the map.
const COLOR_KEY_TO_HEX = {
  red: '#ff8a8a',
  orange: '#ffb26b',
  yellow: '#ffe066',
  lime: '#c1e15b',
  green: '#7ed99a',
  teal: '#66d9cd',
  lightblue: '#79c7ff',
  blue: '#8aa2ff',
  purple: '#bd93f9',
  pink: '#ff9ed8',
  brown: '#d0a679',
  gray: '#c9cdd6',
};

// Region ids currently rendered in the named colour (colorMap[id] = hex). Empty
// when that colour isn't on the board this puzzle.
function regionsForColorKey(key) {
  const ids = new Set();
  const hex = COLOR_KEY_TO_HEX[key];
  if (!hex) return ids;
  for (let id = 0; id < colorMap.length; id++) if (colorMap[id] === hex) ids.add(id);
  return ids;
}

// Expand a list of fill selectors (whole columns / rows / colour-regions) into a
// Set of "r,c" keys, plus any colour names that weren't on the board.
function fillSelectorCells(specs) {
  const N = game.N;
  const set = new Set();
  const missingColors = [];
  const addRegion = (id) => {
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) if (game.region[r][c] === id) set.add(`${r},${c}`);
  };
  for (const spec of specs) {
    if (spec.kind === 'col') {
      for (let r = 0; r < N; r++) set.add(`${r},${spec.v}`);
    } else if (spec.kind === 'row') {
      for (let c = 0; c < N; c++) set.add(`${spec.v},${c}`);
    } else if (spec.kind === 'regionAt') {
      if (spec.row >= 0 && spec.row < N && spec.col >= 0 && spec.col < N) {
        addRegion(game.region[spec.row][spec.col]);
      }
    } else if (spec.kind === 'color') {
      const ids = regionsForColorKey(spec.name);
      if (ids.size === 0) {
        missingColors.push(spec.name);
        continue;
      }
      for (const id of ids) addRegion(id);
    }
  }
  return { set, missingColors };
}

// Does a fill's cell set completely cover at least one whole row, column or
// region? Dotting a whole unit is always a dead end (each unit needs a queen) —
// the game outlines it red, and we warn about it in the voice status. The useful
// "unit außer …" confinement forms leave a gap, so they don't trigger this.
function fillCoversWholeUnit(cells) {
  const N = game.N;
  const inSet = new Set(cells.map((c) => `${c.row},${c.col}`));
  for (let i = 0; i < N; i++) {
    let rowFull = true;
    let colFull = true;
    for (let j = 0; j < N; j++) {
      if (!inSet.has(`${i},${j}`)) rowFull = false;
      if (!inSet.has(`${j},${i}`)) colFull = false;
    }
    if (rowFull || colFull) return true;
  }
  const regionTotal = new Map();
  const regionHit = new Map();
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const id = game.region[r][c];
      regionTotal.set(id, (regionTotal.get(id) || 0) + 1);
      if (inSet.has(`${r},${c}`)) regionHit.set(id, (regionHit.get(id) || 0) + 1);
    }
  for (const [id, total] of regionTotal) if (regionHit.get(id) === total) return true;
  return false;
}

function setVoiceTranscript(text) {
  dom.voiceTranscript.textContent = text || '';
}
function setVoiceStatus(text, kind = '') {
  dom.voiceStatus.textContent = text || '';
  dom.voiceStatus.className = 'voice-status' + (kind ? ' ' + kind : '');
}
function updateVoiceListenButton(listening) {
  voiceListening = !!listening;
  dom.voiceListen.classList.toggle('listening', !!listening);
  dom.voiceListen.setAttribute('aria-pressed', String(!!listening));
  dom.voiceListenLabel.textContent = listening ? 'Stopp' : 'Zuhören';
  if (!listening) voiceCancelSpeech();
}

// Read text aloud, and suppress command processing while it plays so the mic
// doesn't transcribe our own voice (which could e.g. re-trigger "OK"). The
// suppression lifts a beat after speech ends — with a hard safety timeout so a
// browser that never fires `onend` (some headless engines) can't wedge it on.
let voiceSpeakTimer = null;
function releaseSpeaking(delay) {
  if (voiceSpeakTimer) clearTimeout(voiceSpeakTimer);
  voiceSpeakTimer = setTimeout(() => {
    voiceSpeaking = false;
  }, delay);
}
function voiceSay(text) {
  if (!settings.voice || !voiceSpeechSupported() || !text) return;
  voiceSpeaking = true;
  releaseSpeaking(8000); // safety net if onend never arrives
  voiceSpeak(text, { onEnd: () => releaseSpeaking(350) });
}

// Speak a hint and its choices, so the pop-up is usable hands-free.
function voiceSayHint(hint) {
  if (!hint) return;
  let text = `${hint.title}. ${hint.text}`;
  if (hint.applyLabel) text += ' Sag OK zum Übernehmen, oder Schließen zum Verwerfen.';
  voiceSay(text);
}

// Brief accent outline on the cell a command just addressed, so the player sees
// which square was hit even if the label was mis-heard.
function flashVoiceCell(r, c) {
  const cell = cells[r] && cells[r][c];
  if (!cell) return;
  cell.classList.remove('voice-flash');
  void cell.offsetWidth; // restart the animation
  cell.classList.add('voice-flash');
}

// Mutate one cell's state for `action` (no undo/sound/render — the caller rolls
// those up). 'toggle' cycles like a tap; the rest force a state. `autoMarked` is
// an optional frozen auto-mark verdict for 'toggle' (see voiceApplyCells).
function applyCellStateChange(r, c, action, autoMarked) {
  if (action === 'toggle') {
    game.tap(r, c, autoMarked);
  } else if (action === 'queen') {
    if (!game.queen[r][c]) {
      game.queen[r][c] = true;
      game.queenCount++;
      game.mark[r][c] = false;
    }
  } else if (action === 'mark') {
    if (!game.queen[r][c]) game.mark[r][c] = true;
  } else if (action === 'clear') {
    if (game.queen[r][c]) {
      game.queen[r][c] = false;
      game.queenCount--;
    }
    game.mark[r][c] = false;
  }
}

// ---------- Extended debug journal ----------
// A ring buffer of the last 20 voice/board events, kept only when Debug +
// Extended Debug are both on. It records EVERY voice final that was heard (op
// "gehört", incl. ones that changed nothing or weren't understood) plus the
// resulting effect entries (moves, undos, resets, replay-skips) — so the whole
// voice stream is reconstructable, not just the finals that moved a piece. Each
// entry keeps the source, the raw transcript, and (for undos) what was removed.
const JOURNAL_MAX = 20;
let moveJournal = [];
let moveSeq = 0;

function journalEnabled() {
  return settings.debug && settings.debugExtended;
}
function resetJournal() {
  moveJournal = [];
  moveSeq = 0;
}
function queenCoords() {
  return collectQueens().map(([r, c]) => coordLabel(r, c));
}
function journalPush(entry) {
  if (!journalEnabled()) return;
  const e = { n: ++moveSeq, t: currentElapsed() };
  for (const k of Object.keys(entry)) if (entry[k] !== undefined) e[k] = entry[k];
  moveJournal.push(e);
  if (moveJournal.length > JOURNAL_MAX) moveJournal.shift();
}
// Compact one-line summary of a parsed voice command, for the journal.
function voiceCmdSummary(cmd) {
  if (!cmd) return '';
  if (cmd.type === 'cell') return `cell ${coordLabel(cmd.row, cmd.col)} ${cmd.action}`;
  if (cmd.type === 'batch')
    return `batch ${cmd.action} [${cmd.cells.map((c) => coordLabel(c.row, c.col)).join(',')}]`;
  if (cmd.type === 'fill') return `fill ${cmd.action}`;
  if (cmd.type === 'action') return `action ${cmd.action}`;
  return cmd.type;
}

// Apply `action` to one OR MANY cells. Bulk dots/clears/fills are a single
// gesture (one undo snapshot). Queen placements, however, get ONE undo snapshot
// EACH (B2), so a single "zurück" removes exactly one queen even when the
// recogniser merged several "X Dame" utterances into one transcript. `meta`
// (optional { heard, cmd }) feeds the extended-debug journal. Returns
// { ok, reason, placed, dotted, cleared, count, changed }.
function voiceApplyCells(cells, action, meta) {
  if (!game) return { ok: false, reason: 'no-game' };
  if (game.isWon()) return { ok: false, reason: 'won' };
  clearHint();
  const perCell = action === 'queen';
  if (!perCell) pushUndo();
  // Freeze the auto-mark basis for a multi-cell toggle: within one spoken batch
  // ("Punkte auf I5, I6") each named cell should advance one step in the cycle it
  // had when the command was uttered. Computing it live would let a queen placed
  // by an earlier cell auto-mark a later same-column/adjacent cell and skip its
  // dot step straight to a queen — the "I5 I6 → two queens" bug.
  const frozenAuto =
    action === 'toggle' && cells.length > 1
      ? cells.map(({ row, col }) => game._autoMarked(row, col))
      : null;
  let placed = 0;
  let dotted = 0;
  let cleared = 0;
  let changed = 0;
  let lastQueen = null;
  let idx = -1;
  for (const { row: r, col: c } of cells) {
    idx++;
    const wasQueen = game.queen[r][c];
    const wasMark = game.mark[r][c];
    if (perCell) pushUndo();
    applyCellStateChange(r, c, action, frozenAuto ? frozenAuto[idx] : undefined);
    const nowQueen = game.queen[r][c];
    const nowMark = game.mark[r][c];
    const cellChanged = wasQueen !== nowQueen || wasMark !== nowMark;
    if (perCell && !cellChanged) {
      // No-op queen (already there) — drop its snapshot to keep undo clean.
      undoStack.pop();
      updateActionButtons();
    }
    if (cellChanged) changed++;
    if (!wasQueen && nowQueen) {
      placed++;
      lastQueen = { r, c };
      // A queen off the unique solution is a wrong deduction — count each once.
      if (currentSolution && currentSolution[r] !== c) mistakes++;
      if (perCell && journalEnabled())
        journalPush({
          src: 'voice',
          op: `Dame ${coordLabel(r, c)}`,
          heard: meta && meta.heard,
          cmd: meta && meta.cmd,
          queens: queenCoords(),
        });
    } else if (!wasMark && nowMark && !nowQueen) {
      dotted++;
    } else if ((wasQueen || wasMark) && !nowQueen && !nowMark) {
      cleared++;
    }
  }
  if (!perCell && !changed) {
    // Nothing actually changed (e.g. "Punkt" on existing dots) — keep undo clean.
    undoStack.pop();
    updateActionButtons();
  }
  // One representative cue for the whole gesture (place > dot > erase), like a tap.
  if (placed) {
    lastPlaced = lastQueen;
    playPlace();
  } else if (dotted) {
    playDot();
  } else if (cleared) {
    playErase();
  }
  // Bulk (non-queen) gestures log a single journal entry; queens logged per cell.
  if (!perCell && changed && journalEnabled())
    journalPush({
      src: 'voice',
      op: `${VOICE_ACTION_LABEL[action] || action} ×${changed}`,
      heard: meta && meta.heard,
      cmd: meta && meta.cmd,
      queens: queenCoords(),
    });
  updateBoard();
  return { ok: true, placed, dotted, cleared, count: cells.length, changed };
}

// Route a parsed command into the existing actions. `heard` is the raw
// transcript (fed into the extended-debug journal).
function handleVoiceCommand(cmd, heard) {
  const meta = { heard, cmd: voiceCmdSummary(cmd) };
  if (!cmd || cmd.type === 'none') {
    setVoiceStatus('Nicht verstanden – bitte wiederholen.', 'warn');
    return;
  }
  if (cmd.type === 'stop') {
    stopVoiceListening();
    setVoiceStatus('Zuhören beendet.');
    return;
  }
  if (cmd.type === 'action') {
    switch (cmd.action) {
      case 'newGame':
        setVoiceStatus('Neues Spiel', 'ok');
        newGame();
        break;
      case 'hint':
        showHint();
        setVoiceStatus('Hinweis', 'ok');
        break;
      case 'check':
        runCheck();
        setVoiceStatus('Prüfen', 'ok');
        break;
      case 'undo':
        clearHint();
        doUndo('voice', heard);
        setVoiceStatus('Rückgängig', 'ok');
        break;
      case 'reset':
        if (game && !game.isWon()) {
          clearHint();
          pushUndo();
          game.reset();
          startTimer(); // clears the journal too
          updateBoard();
          if (journalEnabled()) journalPush({ src: 'voice', op: 'reset', heard, queens: [] });
          setVoiceStatus('Zurückgesetzt', 'ok');
        }
        break;
      // Context commands for the hint pop-up (say "OK" to take the hint).
      case 'apply':
        if (hintActive) {
          applyHint();
          setVoiceStatus('Hinweis übernommen', 'ok');
        } else {
          setVoiceStatus('Kein Hinweis offen.', 'warn');
        }
        break;
      case 'dismiss':
        if (hintActive) {
          clearHint();
          setVoiceStatus('Hinweis geschlossen');
        }
        break;
      case 'repeat':
        if (hintActive && currentHint) voiceSayHint(currentHint);
        else setVoiceStatus('Nichts zum Vorlesen.', 'warn');
        break;
    }
    return;
  }
  if (cmd.type === 'cell' || cmd.type === 'batch') {
    const cells = cmd.type === 'cell' ? [{ row: cmd.row, col: cmd.col }] : cmd.cells;
    // Drop cells that merely replay the immediately-prior voice command (Chrome
    // re-finalising the same utterance) — but keep any whose action differs, so a
    // verb-completed re-finalise ("i5" → "i5 Dame") still upgrades the cell.
    const within = lastVoiceReplayKeys && Date.now() - lastVoiceReplayAt <= VOICE_REPLAY_MS;
    const { apply, keys } = dedupeReplayCells(cells, cmd.action, within ? lastVoiceReplayKeys : null);
    lastVoiceReplayKeys = keys;
    lastVoiceReplayAt = Date.now();
    if (apply.length === 0) {
      // Whole command was a replay of the last one — do nothing, but record it.
      if (journalEnabled())
        journalPush({ src: 'voice', op: 'Replay übersprungen', heard: meta.heard, cmd: meta.cmd });
      setVoiceStatus('Wiederholung übersprungen.');
      return;
    }
    const res = voiceApplyCells(apply, cmd.action, meta);
    if (!res.ok) {
      setVoiceStatus(res.reason === 'won' ? 'Gelöst – sag „Neues Spiel“.' : 'Kein aktives Spiel.', 'warn');
      return;
    }
    for (const { row, col } of apply) flashVoiceCell(row, col);
    const label = VOICE_ACTION_LABEL[cmd.action] || '';
    if (apply.length === 1) {
      setVoiceStatus(`${coordLabel(apply[0].row, apply[0].col)} · ${label}`.trim(), 'ok');
    } else {
      const list = apply.map((c) => coordLabel(c.row, c.col)).join(', ');
      setVoiceStatus(`${apply.length} Felder · ${label} (${list})`, 'ok');
    }
    return;
  }

  if (cmd.type === 'fill') {
    if (!game) {
      setVoiceStatus('Kein aktives Spiel.', 'warn');
      return;
    }
    if (game.isWon()) {
      setVoiceStatus('Gelöst – sag „Neues Spiel“.', 'warn');
      return;
    }
    // Chrome finalises mid-sentence: "Punkte Zeile 1 außer Region E1" arrives
    // first as the bare "Punkte Zeile 1", which dots the WHOLE row. Re-running
    // the completed, narrower command can't take those dots back (marking only
    // adds), so the row stayed fully dotted and the exclusion was silently lost.
    // When a fill final merely extends the previous one, roll the earlier fill
    // back and let the completed utterance apply instead. The full new
    // transcript is re-parsed — no text is stripped, so a leading verb still
    // governs the whole phrase.
    const topSnap = undoStack.length ? undoStack[undoStack.length - 1] : null;
    if (
      lastVoiceFill &&
      lastVoiceFill.snap &&
      lastVoiceFill.snap === topSnap &&
      Date.now() - lastVoiceFill.at <= VOICE_REPLAY_MS &&
      isRefinaliseExtension(lastVoiceFill.text, heard)
    ) {
      const s = undoStack.pop();
      game.mark = s.mark;
      game.queen = s.queen;
      game.queenCount = s.queenCount;
      lastPlaced = null;
      updateActionButtons();
      lastVoiceFill = { ...lastVoiceFill, snap: null };
      if (journalEnabled())
        journalPush({ src: 'voice', op: 'Fill zurückgenommen (Satz ergänzt)', heard, cmd: meta.cmd });
    }
    const inc = fillSelectorCells(cmd.include);
    const exc = fillSelectorCells(cmd.exclude);
    const cells = [];
    for (const key of inc.set) {
      if (exc.set.has(key)) continue;
      const [r, c] = key.split(',').map(Number);
      cells.push({ row: r, col: c });
    }
    const missing = [...inc.missingColors, ...exc.missingColors];
    if (cells.length === 0) {
      // Keep the chain alive so a further extension of this same sentence is
      // still recognised as a correction rather than a fresh command.
      lastVoiceFill = { text: heard, at: Date.now(), snap: lastVoiceFill && lastVoiceFill.snap };
      setVoiceStatus(
        missing.length ? 'Diese Farbe ist nicht auf dem Feld.' : 'Keine passenden Felder gefunden.',
        'warn'
      );
      return;
    }
    const res = voiceApplyCells(cells, cmd.action, meta);
    if (!res.ok) {
      setVoiceStatus(res.reason === 'won' ? 'Gelöst – sag „Neues Spiel“.' : 'Kein aktives Spiel.', 'warn');
      return;
    }
    // Remember what to roll back if this sentence turns out to be unfinished. A
    // fill that changed nothing pushed no snapshot, so the previous fill (if its
    // snapshot is still on top) stays the rollback target.
    const nowTop = undoStack.length ? undoStack[undoStack.length - 1] : null;
    const keptSnap = lastVoiceFill && lastVoiceFill.snap === nowTop ? lastVoiceFill.snap : null;
    lastVoiceFill = { text: heard, at: Date.now(), snap: res.changed ? nowTop : keptSnap };
    for (const { row, col } of cells) flashVoiceCell(row, col);
    let status = `${res.count} Felder · ${VOICE_ACTION_LABEL[cmd.action] || ''}`.trim();
    if (missing.length) status += ' · Farbe nicht gefunden';
    // Dotting a whole row/column/region can never be right (each needs a queen).
    // Flag it — the command still runs, but as a warning, not a plain OK.
    if (cmd.action === 'mark' && fillCoversWholeUnit(cells)) {
      setVoiceStatus(`${status} · ganze Einheit = Sackgasse`, 'warn');
    } else {
      setVoiceStatus(status, 'ok');
    }
  }
}

// A final result arrives as ranked alternatives; take the first that parses to a
// real command (recovers a mis-heard letter far better than trusting only the
// top guess).
function handleVoiceFinal(alts) {
  // Ignore whatever the mic heard while we were reading a hint aloud — it's most
  // likely our own synthesised voice echoing back.
  if (voiceSpeaking) return;
  const N = game ? game.N : settings.size;
  let cmd = { type: 'none' };
  let used = alts && alts.length ? alts[0] : '';
  if (alts) {
    for (const a of alts) {
      const parsed = parseVoiceCommand(a, N);
      if (parsed.type !== 'none') {
        cmd = parsed;
        used = a;
        break;
      }
    }
  }
  setVoiceTranscript(used);
  // Log EVERY final — even ones that change nothing (not understood, no-op) — so
  // the extended-debug journal reflects the whole voice stream, not just the
  // finals that moved a piece. The other alternatives ride along to expose
  // mis-hearings the parser had to recover from.
  if (journalEnabled())
    journalPush({
      src: 'voice',
      op: 'gehört',
      heard: used,
      cmd: voiceCmdSummary(cmd),
      alts: alts && alts.length > 1 ? alts.join(' | ') : undefined,
    });
  // Only back-to-back finals of the SAME kind can be re-finalises of each other,
  // so a different command kind breaks the relevant chain and the next one is
  // judged fresh. A `none` is exempt from both: Chrome sprinkles empty/garbled
  // finals through a sentence it is still transcribing (the debug journal shows
  // five in a row mid-utterance), and since a miss changes nothing it must not
  // make the real continuation look like a fresh command.
  if (cmd.type !== 'none') {
    if (cmd.type !== 'cell' && cmd.type !== 'batch') lastVoiceReplayKeys = null;
    if (cmd.type !== 'fill') lastVoiceFill = null;
  }
  handleVoiceCommand(cmd, used);
}

function ensureVoiceController() {
  if (voiceController || !voiceSupported()) return voiceController;
  voiceController = createVoiceController({
    onInterim: (text) => setVoiceTranscript(text),
    onFinal: (alts) => handleVoiceFinal(alts),
    onStateChange: (state) => updateVoiceListenButton(state === 'listening'),
    onError: (kind) => {
      if (kind === 'not-allowed' || kind === 'service-not-allowed') {
        setVoiceStatus('Mikrofon-Zugriff verweigert.', 'warn');
        stopVoiceListening();
      } else if (kind === 'audio-capture') {
        setVoiceStatus('Kein Mikrofon gefunden.', 'warn');
        stopVoiceListening();
      }
      // 'no-speech'/'aborted' are benign — the controller keeps listening.
    },
  });
  return voiceController;
}

function startVoiceListening() {
  const c = ensureVoiceController();
  if (!c) return;
  setVoiceStatus('Zuhören … sprich einen Befehl.');
  updateVoiceListenButton(true); // optimistic; onStateChange corrects it
  c.start();
}
function stopVoiceListening() {
  if (voiceController) voiceController.stop();
  updateVoiceListenButton(false);
}
function toggleVoiceListening() {
  const c = ensureVoiceController();
  if (!c) return;
  if (c.isListening()) stopVoiceListening();
  else startVoiceListening();
}

// Voice Mode is a GERMAN feature, not a translated one: js/voice.js parses a
// German speech grammar (spelling alphabet, number words, "außer", and a set of
// mis-hearings found by actually speaking at it), the recogniser runs at
// VOICE_LANG = 'de-DE', and the ⓘ tutorial documents that grammar. None of that
// transfers by translating strings, so the whole feature is gated to the German
// UI rather than shipped half-working — a French UI driving a de-DE recogniser
// would just produce nonsense. Lifting the gate means adding a grammar, not a
// language pack (see CLAUDE.md → "i18n").
const VOICE_UI_LANG = 'de';
function voiceAvailable() {
  return voiceSupported() && getLanguage() === VOICE_UI_LANG;
}

// Show/hide the panel + coordinate labels from the preference, and disable the
// whole feature where the Web Speech API is missing (Safari/Firefox) or the UI
// isn't German.
function applyVoiceSetting() {
  const supported = voiceSupported();
  const available = voiceAvailable();
  if (dom.voiceMode) dom.voiceMode.disabled = !available;
  // Say WHY it's off — an unexplained disabled switch reads as a bug. Appended
  // once, after applyTranslations has put the base hint in place.
  if (dom.voiceModeHint && !available && !dom.voiceModeHint.dataset.note) {
    dom.voiceModeHint.dataset.note = '1';
    dom.voiceModeHint.textContent += supported
      ? t('settings.voice.germanOnly')
      : t('settings.voice.unsupported');
  }
  const on = !!settings.voice && available;
  // Two mutually exclusive coordinate styles: small labels in each cell's corner
  // (default) or a large chess-style ruler along the board's edges.
  const edge = on && !!settings.voiceEdgeLabels;
  dom.voicePanel.hidden = !on;
  dom.board.classList.toggle('show-coords', on && !edge);
  dom.boardStage.classList.toggle('show-edge-coords', edge);
  if (!on) {
    stopVoiceListening();
    setVoiceTranscript('');
    setVoiceStatus('');
  }
}

// The edge-labels sub-option only makes sense with Voice Mode on, so it's shown
// in the settings modal only while the Voice Mode switch is checked (and the
// feature is actually available — browser support plus the German UI).
function updateVoiceSubOptions() {
  dom.voiceEdgeField.hidden = !(voiceAvailable() && dom.voiceMode.checked);
}

dom.voiceListen.addEventListener('click', () => {
  playUi();
  toggleVoiceListening();
});
dom.voiceMode.addEventListener('change', () => {
  settings.voice = dom.voiceMode.checked;
  saveSettings(settings);
  updateVoiceSubOptions();
  applyVoiceSetting();
});
dom.voiceEdgeMode.addEventListener('change', () => {
  settings.voiceEdgeLabels = dom.voiceEdgeMode.checked;
  saveSettings(settings);
  applyVoiceSetting();
});

// The ⓘ tutorial: what you can say and how the board reacts.
dom.voiceHelp.addEventListener('click', () => {
  playUi();
  show(dom.voiceHelpOverlay);
});
dom.voiceHelpClose.addEventListener('click', () => hide(dom.voiceHelpOverlay));
dom.voiceHelpOverlay.addEventListener('click', (e) => {
  if (e.target === dom.voiceHelpOverlay) hide(dom.voiceHelpOverlay);
});

// ---------- helpers ----------
function show(node) {
  node.hidden = false;
}
function hide(node) {
  node.hidden = true;
}

// ---------- boot ----------
// Translate before anything renders — this also reveals the .app shell, which
// the CSS keeps hidden until data-i18n-ready lands (see applyTranslations).
applyTranslations();
populateLanguageSelect();
// Backfill the solve history from the top list once per bucket. Devices that
// played before the history existed would otherwise compare a fresh solve
// against an empty past. Idempotent, so it's safe on every boot.
seedSolveHistory();
updateDebugButton();
applySoundSetting();
applyVoiceSetting();
newGame();
