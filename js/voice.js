// voice.js
// Voice Mode: steer the whole game by speaking. Two clearly separated halves so
// the logic half stays testable without a browser (mirrors how audio.js is an
// audio-only layer and leaderboard.js a network-only one):
//
//   1. parseVoiceCommand(transcript, N) — a PURE function. No DOM, no browser
//      globals, no Web Speech API. Turns a German transcript into a structured
//      command. Node can import and unit-test it directly (see
//      tests/logic/voice-parse.mjs).
//   2. createVoiceController(...) — a thin wrapper around the Web Speech API
//      (SpeechRecognition). It only touches `window` inside its own functions,
//      so importing this module in Node never crashes; voiceSupported() below is
//      the feature gate.
//
// Grid notation is chess-like: a COLUMN letter (A across the top, left→right)
// plus a ROW number (1 at the top, top→bottom). "C4" = column C, row 4. Short,
// unambiguous utterances that map straight onto the data model (region[r][c]):
// letter → column c, number → row r. The German spelling alphabet ("Cäsar für
// C") and spoken number words are accepted too, since single spoken letters are
// notoriously mis-recognised.
//
// Bundle constraints (this file is concatenated into the classic-script Artifact
// bundle): no `import.meta`, and no top-level name collisions with other modules
// — hence the VOICE_/voice-prefixed top-level names.

export const VOICE_LANG = 'de-DE';

// Highest board size we can address: columns A..L cover 12, matching MAX_SIZE.
export const VOICE_MAX_SIZE = 12;

// Column A=0 .. L=11. Includes the German spelling alphabet, the NATO alphabet
// (people reach for it), and the bare letter as a browser might transcribe it.
const VOICE_COL_WORDS = {
  a: 0, anton: 0, alfa: 0, alpha: 0,
  b: 1, be: 1, berta: 1, bertha: 1, bravo: 1,
  c: 2, ce: 2, zeh: 2, zäh: 2, 'cäsar': 2, caesar: 2, cesar: 2, charlie: 2,
  d: 3, de: 3, dora: 3, delta: 3,
  e: 4, emil: 4, echo: 4,
  f: 5, ef: 5, friedrich: 5, foxtrott: 5, foxtrot: 5,
  g: 6, ge: 6, gustav: 6, golf: 6,
  h: 7, ha: 7, heinrich: 7, hotel: 7,
  i: 8, ida: 8, india: 8,
  j: 9, jot: 9, jott: 9, julius: 9, juliett: 9,
  k: 10, ka: 10, kaufmann: 10, konrad: 10, kilo: 10,
  l: 11, el: 11, ludwig: 11, lima: 11,
};

// Spoken number words 1..12 (plus common variants a recogniser emits).
const VOICE_NUM_WORDS = {
  eins: 1, ein: 1, eine: 1,
  zwei: 2, zwo: 2,
  drei: 3,
  vier: 4,
  'fünf': 5, fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  'zwölf': 12, zwoelf: 12,
};

// Unit words for whole-line/region fills. Regions are named by COLOUR (the game
// shuffles colours per puzzle, so the pure parser can't know which colour is
// which region — it emits a canonical colour key and main.js resolves it).
const VOICE_COLUMN_WORDS = new Set(['spalte', 'spalten']);
const VOICE_ROW_WORDS = new Set(['zeile', 'zeilen', 'reihe', 'reihen']);
const VOICE_REGION_WORDS = new Set(['farbe', 'farben', 'region', 'regionen']);
// Exclusion markers: everything after one is the "except" set.
const VOICE_EXCLUDE_WORDS = new Set(['außer', 'ausser', 'ohne', 'ausgenommen', 'exkl', 'exklusive']);

// Spoken colour → canonical key (main.js maps the key to a palette colour).
const VOICE_COLOR_WORDS = {
  rot: 'red', hellrot: 'red',
  orange: 'orange',
  gelb: 'yellow',
  'hellgrün': 'lime', hellgruen: 'lime', limette: 'lime', limone: 'lime',
  'grün': 'green', gruen: 'green',
  'türkis': 'teal', tuerkis: 'teal', cyan: 'teal', mint: 'teal',
  hellblau: 'lightblue',
  blau: 'blue',
  lila: 'purple', violett: 'purple', purpur: 'purple', purple: 'purple',
  rosa: 'pink', pink: 'pink', magenta: 'pink',
  braun: 'brown', brown: 'brown',
  grau: 'gray', grey: 'gray', gray: 'gray',
};
function voiceColorKey(tok) {
  return Object.prototype.hasOwnProperty.call(VOICE_COLOR_WORDS, tok) ? VOICE_COLOR_WORDS[tok] : null;
}

// Column index (0-based) → its letter. A, B, C, …
export function colLetter(c) {
  return String.fromCharCode(65 + c);
}

// Cell (r,c) → its spoken/printed coordinate, e.g. (3,2) → "C4".
export function coordLabel(r, c) {
  return colLetter(c) + (r + 1);
}

// Lower-case, strip punctuation, collapse whitespace → a token array.
function voiceNormalize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[.,!?;:_/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Map a single token to a column index, or null. Only accepts columns that fit
// on an N×N board, so an out-of-range letter is ignored rather than misfired.
function voiceCol(token, N) {
  if (!Object.prototype.hasOwnProperty.call(VOICE_COL_WORDS, token)) return null;
  const c = VOICE_COL_WORDS[token];
  return c < N ? c : null;
}

// Map a single token to a row number (1..N), or null.
function voiceNum(token, N) {
  let n = null;
  if (/^\d+$/.test(token)) n = parseInt(token, 10);
  else if (Object.prototype.hasOwnProperty.call(VOICE_NUM_WORDS, token)) n = VOICE_NUM_WORDS[token];
  if (n == null) return null;
  return n >= 1 && n <= N ? n : null;
}

// Scan the tokens for EVERY valid coordinate, in order, so one utterance can
// address several cells ("A2 B2 C3"). Columns and numbers may come in either
// order (chess says "C4" but speech is unpredictable); a glued token like "c4"
// or "4c" is split so it still resolves. Returns an array of { row, col }.
function voiceFindAllCoords(tokens, N) {
  // Flatten tokens into typed items: a column index or a row number. Anything
  // else (filler words like "auf"/"und") is dropped.
  const items = [];
  const classify = (tok) => {
    const c = voiceCol(tok, N);
    if (c !== null) {
      items.push({ t: 'col', v: c });
      return;
    }
    const n = voiceNum(tok, N);
    if (n !== null) items.push({ t: 'num', v: n });
  };
  for (const tok of tokens) {
    let m;
    if ((m = /^([a-zäöü]+)(\d+)$/.exec(tok))) {
      classify(m[1]);
      classify(m[2]);
    } else if ((m = /^(\d+)([a-zäöü]+)$/.exec(tok))) {
      classify(m[1]);
      classify(m[2]);
    } else {
      classify(tok);
    }
  }
  // Greedily pair a column with a number (either order) into a coordinate.
  const coords = [];
  let pendCol = null;
  let pendNum = null;
  for (const it of items) {
    if (it.t === 'col') pendCol = it.v;
    else pendNum = it.v;
    if (pendCol !== null && pendNum !== null) {
      coords.push({ row: pendNum - 1, col: pendCol });
      pendCol = null;
      pendNum = null;
    }
  }
  return coords;
}

// Which cell action a coordinate utterance carries. Default 'toggle' cycles the
// cell exactly like a tap (empty → dot → queen → empty). Specific mark/clear
// verbs are checked before the generic "setzen" so "Punkte auf …" marks rather
// than placing queens.
function voiceCellAction(norm) {
  if (/\b(dame|damen|k[oö]nigin|krone|queen)\b/.test(norm)) return 'queen';
  if (/\b(punkt\w*|markier\w*|kreuz|dot)\b/.test(norm)) return 'mark';
  if (/\b(l[oö]sch\w*|leer\w*|entfern\w*|frei|weg|raus)\b/.test(norm)) return 'clear';
  if (/\b(setzen?|setze|platzier\w*)\b/.test(norm)) return 'queen';
  return 'toggle';
}

// The action a whole-line/region fill carries. Bulk work is almost always
// dotting, so 'mark' is the default (unlike a bare cell, which toggles).
function voiceFillAction(norm) {
  if (/\b(l[oö]sch\w*|leer\w*|entfern\w*|frei|weg|raus)\b/.test(norm)) return 'clear';
  if (/\b(dame|damen|k[oö]nigin|setzen?|setze|platzier\w*)\b/.test(norm)) return 'queen';
  if (/\b(durchschalt\w*|umschalt\w*|toggle)\b/.test(norm)) return 'toggle';
  return 'mark';
}

// Scan tokens into fill selectors, each one of:
//   { kind:'col', v } | { kind:'row', v } | { kind:'color', name } |
//   { kind:'regionAt', row, col }
// A unit word ("Spalte"/"Zeile"/"Region") sets the context for what follows:
// letters after "Spalte", numbers after "Zeile", and after "Region" either a
// colour ("Region Rot") or a cell that identifies the region ("Region von C3").
// Colours are self-identifying anywhere. Rows/cols are 0-based. Used for both
// the include and the exclude ("außer …") side of a fill.
function voiceScanSelectors(tokens, N) {
  // Pre-split glued letter+digit tokens ("c3") so "Region von C3" resolves.
  const flat = [];
  for (const tok of tokens) {
    let m;
    if ((m = /^([a-zäöü]+)(\d+)$/.exec(tok))) {
      flat.push(m[1], m[2]);
    } else if ((m = /^(\d+)([a-zäöü]+)$/.exec(tok))) {
      flat.push(m[1], m[2]);
    } else {
      flat.push(tok);
    }
  }
  const specs = [];
  let unit = null;
  let pendCol = null;
  let pendNum = null;
  const flushRegionAt = () => {
    if (pendCol !== null && pendNum !== null) {
      specs.push({ kind: 'regionAt', row: pendNum - 1, col: pendCol });
      pendCol = null;
      pendNum = null;
    }
  };
  for (const tok of flat) {
    if (VOICE_COLUMN_WORDS.has(tok)) {
      unit = 'col';
      pendCol = pendNum = null;
      continue;
    }
    if (VOICE_ROW_WORDS.has(tok)) {
      unit = 'row';
      pendCol = pendNum = null;
      continue;
    }
    if (VOICE_REGION_WORDS.has(tok)) {
      unit = 'region';
      pendCol = pendNum = null;
      continue;
    }
    const color = voiceColorKey(tok);
    if (color) {
      specs.push({ kind: 'color', name: color });
      continue;
    }
    if (unit === 'col') {
      const c = voiceCol(tok, N);
      if (c !== null) specs.push({ kind: 'col', v: c });
    } else if (unit === 'row') {
      const n = voiceNum(tok, N);
      if (n !== null) specs.push({ kind: 'row', v: n - 1 });
    } else if (unit === 'region') {
      // A cell coordinate identifies the region it lies in.
      const c = voiceCol(tok, N);
      if (c !== null) {
        pendCol = c;
        flushRegionAt();
        continue;
      }
      const n = voiceNum(tok, N);
      if (n !== null) {
        pendNum = n;
        flushRegionAt();
      }
    }
  }
  return specs;
}

// Parse a German transcript into a structured command. Pure — safe in Node.
// Returns one of:
//   { type: 'cell', row, col, action }  action: 'toggle'|'queen'|'mark'|'clear'
//   { type: 'batch', action, cells }    several cells, one shared action
//   { type: 'action', action }          action: 'newGame'|'hint'|'check'|'undo'|'reset'
//   { type: 'stop' }                    stop listening
//   { type: 'none' }                    nothing recognised
export function parseVoiceCommand(transcript, N = 8) {
  const norm = voiceNormalize(transcript);
  if (!norm) return { type: 'none' };
  const tokens = norm.split(' ');

  // Stop listening — checked first so it always wins.
  if (/\b(stop\w*|pause|h[oö]r\w* auf|ruhe|aus)\b/.test(norm)) return { type: 'stop' };

  // Whole-line/region fill: "Punkte Spalte B und C außer Rot". Split on the
  // exclusion marker, then scan each side into unit/colour selectors. Detected
  // before coordinates so a unit word wins over a stray letter/number.
  const exclIdx = tokens.findIndex((t) => VOICE_EXCLUDE_WORDS.has(t));
  const inclTokens = exclIdx === -1 ? tokens : tokens.slice(0, exclIdx);
  const inclHasUnit = inclTokens.some(
    (t) =>
      VOICE_COLUMN_WORDS.has(t) ||
      VOICE_ROW_WORDS.has(t) ||
      VOICE_REGION_WORDS.has(t) ||
      voiceColorKey(t)
  );
  if (inclHasUnit) {
    const include = voiceScanSelectors(inclTokens, N);
    if (include.length) {
      const exclude = exclIdx === -1 ? [] : voiceScanSelectors(tokens.slice(exclIdx + 1), N);
      return { type: 'fill', action: voiceFillAction(norm), include, exclude };
    }
  }

  // One or more coordinates make it a cell command; the verb (if any) picks the
  // shared action. Several coordinates in one breath ("Punkte auf A2, B2, C3")
  // become a batch.
  const coords = voiceFindAllCoords(tokens, N);
  if (coords.length) {
    const action = voiceCellAction(norm);
    // Drop duplicates but keep order — a repeat in one breath is almost always a
    // recogniser hiccup, not intent.
    const seen = new Set();
    const cells = [];
    for (const c of coords) {
      const k = c.row + ',' + c.col;
      if (!seen.has(k)) {
        seen.add(k);
        cells.push(c);
      }
    }
    if (cells.length === 1) {
      return { type: 'cell', row: cells[0].row, col: cells[0].col, action };
    }
    return { type: 'batch', action, cells };
  }

  // No coordinate → a global action. Order matters: "zurücksetzen" contains
  // "zurück", so match reset before undo.
  // New game needs an explicit phrase ("neues Spiel", "Neustart", "neu
  // starten") — a BARE "neu" is deliberately NOT accepted: the recogniser often
  // clips the row number "neun" to "neu", and starting a whole new game (losing
  // the board) on that misfire is far worse than ignoring a lone "neu".
  if (/\bneu(es|e)?\s+spiel\b|\bneustart\b|\bneu\s+start\w*\b/.test(norm))
    return { type: 'action', action: 'newGame' };
  if (/\b(hinweis|tipp|hilfe)\b/.test(norm)) return { type: 'action', action: 'hint' };
  if (/\b(pr[uü]f\w*|check|kontrolle)\b/.test(norm)) return { type: 'action', action: 'check' };
  // Board reset needs an explicit phrase. A bare "leeren"/"löschen" is the
  // cell-clear verb — if the coordinate was mis-heard it must NOT wipe the whole
  // board, so it deliberately falls through to "none" here.
  if (
    /\b(zur[uü]cksetzen|reset|neu anfangen)\b/.test(norm) ||
    /\balles (l[oö]sch\w*|leer\w*)\b/.test(norm) ||
    /\bfeld (l[oö]sch\w*|leer\w*)\b/.test(norm)
  )
    return { type: 'action', action: 'reset' };
  if (/\b(zur[uü]ck|r[uü]ckg[aä]ngig|undo)\b/.test(norm)) return { type: 'action', action: 'undo' };

  // Confirm / dismiss / re-read — context commands for an open card (e.g. a hint
  // pop-up). Checked LAST, so a real cell/fill/action command containing a filler
  // like "ja"/"ok" wins (e.g. "ja C4 Dame" places C4, it isn't swallowed as
  // "apply"). Matched by exact token (not \b regex): ß/ü aren't \w, so a word
  // boundary before "ü" in "übernehmen" would never fire.
  const tokenSet = new Set(tokens);
  const anyToken = (...words) => words.some((w) => tokenSet.has(w));
  if (anyToken('ok', 'okay', 'okey', 'übernehmen', 'uebernehmen', 'annehmen', 'passt', 'jawohl', 'ja'))
    return { type: 'action', action: 'apply' };
  if (anyToken('schließen', 'schliessen', 'verwerfen', 'abbrechen', 'nein'))
    return { type: 'action', action: 'dismiss' };
  if (anyToken('vorlesen', 'wiederholen', 'wiederhole', 'wiederhol', 'nochmal') || /noch\s+(mal|einmal)/.test(norm))
    return { type: 'action', action: 'repeat' };

  return { type: 'none' };
}

// Guard against a re-finalised recognition segment replaying an already-applied
// coordinate command. In `continuous` mode Chrome can finalise "i5" and then,
// a beat later, re-finalise the SAME utterance either extended ("i5 i6") or
// verb-completed ("i5 Dame"). Working on the raw transcript is unsafe — a leading
// verb governs every coordinate in the phrase, so stripping a shared prefix drops
// meaning ("Damen A2 B5" → tail "b5" would toggle, not place a queen). So we
// compare the *parsed effect per cell* instead: a genuine replay is the same cell
// with the same action (drop it); a new cell, or the same cell with a different
// action (a verb turned a toggle into a queen), is a real change (keep it).
//
// `prevKeys` is a Set of "r,c,action" keys from the immediately-prior voice
// coordinate command, or null when the chain is broken / the window lapsed (the
// caller owns that timing). Returns `{ apply, keys }`: `apply` is the subset of
// cells to actually act on, `keys` is the FULL key set of THIS command to
// remember for the next call (so a third re-finalise still recognises them).
// PURE. A *deliberately* repeated identical cell+action within the window is
// dropped too — an accepted, now-narrow trade for killing the re-finalise replay.
export function dedupeReplayCells(cells, action, prevKeys) {
  const keys = new Set();
  const apply = [];
  for (const cell of cells) {
    const k = cell.row + ',' + cell.col + ',' + action;
    keys.add(k);
    if (!prevKeys || !prevKeys.has(k)) apply.push(cell);
  }
  return { apply, keys };
}

// Is the Web Speech API available? Safe to call in Node (returns false).
export function voiceSupported() {
  return (
    typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  );
}

// Is speech synthesis (reading text aloud) available? Safe in Node.
export function voiceSpeechSupported() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  );
}

// Read `text` aloud (German by default). Fails soft — if synthesis is missing or
// throws, onEnd still fires so callers can lift a "speaking" suppression. Any
// queued/ongoing utterance is cancelled first so hints don't pile up.
export function voiceSpeak(text, opts = {}) {
  const { lang = VOICE_LANG, onStart, onEnd } = opts;
  const done = () => {
    if (onEnd) onEnd();
  };
  try {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!synth || !text || typeof window.SpeechSynthesisUtterance === 'undefined') {
      done();
      return false;
    }
    synth.cancel();
    const u = new window.SpeechSynthesisUtterance(String(text));
    u.lang = lang;
    if (onStart) u.onstart = onStart;
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
    return true;
  } catch (e) {
    done();
    return false;
  }
}

// Stop any ongoing/queued speech. Fails soft.
export function voiceCancelSpeech() {
  try {
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  } catch (e) {
    /* ignore */
  }
}

// A thin, self-restarting wrapper around SpeechRecognition. It emits raw text
// only — parsing stays in parseVoiceCommand so the recogniser knows nothing
// about the game. Callbacks (all optional):
//   onInterim(text)          — live, not-yet-final transcript
//   onFinal(alternatives[])  — final result as ranked alternative strings
//   onStateChange(state)     — 'listening' | 'idle'
//   onError(kind)            — the SpeechRecognition error string
//
// Returns { start, stop, toggle, isListening }. Fails soft everywhere: if the
// API is missing or a call throws, nothing happens and the game is unaffected —
// the same graceful-degradation contract as audio.js / leaderboard.js.
export function createVoiceController(opts = {}) {
  const { lang = VOICE_LANG, onInterim, onFinal, onStateChange, onError } = opts;
  const Ctor =
    typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

  let rec = null;
  let listening = false;
  let wantOn = false; // desired state; drives auto-restart when the engine stops

  function build() {
    if (rec || !Ctor) return rec;
    try {
      rec = new Ctor();
    } catch (e) {
      rec = null;
      return null;
    }
    rec.lang = lang;
    rec.continuous = true; // keep listening for many commands, not just one
    rec.interimResults = true; // show live text as the user speaks
    rec.maxAlternatives = 4; // more chances to recover a mis-heard letter

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const alts = [];
          for (let a = 0; a < result.length; a++) alts.push(result[a].transcript);
          if (onFinal) onFinal(alts);
        } else {
          interim += result[0].transcript;
        }
      }
      if (interim && onInterim) onInterim(interim);
    };

    rec.onstart = () => {
      listening = true;
      if (onStateChange) onStateChange('listening');
    };

    rec.onerror = (event) => {
      // 'no-speech'/'aborted' are benign; onend handles the restart. Surface the
      // rest (e.g. 'not-allowed' when mic permission is denied).
      if (onError) onError(event && event.error ? event.error : 'error');
    };

    rec.onend = () => {
      listening = false;
      if (wantOn) {
        // Continuous mode still stops after a pause on some engines — restart.
        try {
          rec.start();
          return;
        } catch (e) {
          wantOn = false;
        }
      }
      if (onStateChange) onStateChange('idle');
    };

    return rec;
  }

  function start() {
    if (!Ctor) return false;
    if (!build()) return false;
    wantOn = true;
    if (listening) return true;
    try {
      rec.start();
      return true;
    } catch (e) {
      // start() throws if already started — treat as listening.
      return listening;
    }
  }

  function stop() {
    wantOn = false;
    if (rec) {
      try {
        rec.stop();
      } catch (e) {
        /* ignore */
      }
    }
    listening = false;
  }

  return {
    start,
    stop,
    toggle() {
      return wantOn ? (stop(), false) : start();
    },
    isListening() {
      return listening;
    },
  };
}
