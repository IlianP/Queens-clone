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

// Scan the tokens for the first valid column and the first valid row, in any
// order (chess says "C4" but speech is unpredictable). A glued token like "c4"
// or "4c" is split so it still resolves. Returns { row, col } (0-based) or null.
function voiceFindCoord(tokens, N) {
  let col = null;
  let num = null;
  const consider = (t) => {
    if (col === null) {
      const c = voiceCol(t, N);
      if (c !== null) col = c;
    }
    if (num === null) {
      const n = voiceNum(t, N);
      if (n !== null) num = n;
    }
  };
  for (const t of tokens) {
    let m;
    if ((m = /^([a-zäöü]+)(\d+)$/.exec(t))) {
      consider(m[1]);
      consider(m[2]);
    } else if ((m = /^(\d+)([a-zäöü]+)$/.exec(t))) {
      consider(m[1]);
      consider(m[2]);
    } else {
      consider(t);
    }
    if (col !== null && num !== null) break;
  }
  if (col === null || num === null) return null;
  return { row: num - 1, col };
}

// Which cell action a coordinate utterance carries. Default 'toggle' cycles the
// cell exactly like a tap (empty → dot → queen → empty).
function voiceCellAction(norm) {
  if (/\b(dame|damen|k[oö]nigin|krone|queen|setzen?|setze|platzier\w*)\b/.test(norm)) return 'queen';
  if (/\b(l[oö]sch\w*|leer\w*|entfern\w*|frei|weg|raus)\b/.test(norm)) return 'clear';
  if (/\b(punkt|markier\w*|kreuz|dot)\b/.test(norm)) return 'mark';
  return 'toggle';
}

// Parse a German transcript into a structured command. Pure — safe in Node.
// Returns one of:
//   { type: 'cell', row, col, action }  action: 'toggle'|'queen'|'mark'|'clear'
//   { type: 'action', action }          action: 'newGame'|'hint'|'check'|'undo'|'reset'
//   { type: 'stop' }                    stop listening
//   { type: 'none' }                    nothing recognised
export function parseVoiceCommand(transcript, N = 8) {
  const norm = voiceNormalize(transcript);
  if (!norm) return { type: 'none' };
  const tokens = norm.split(' ');

  // Stop listening — checked first so it always wins.
  if (/\b(stop\w*|pause|h[oö]r\w* auf|ruhe|aus)\b/.test(norm)) return { type: 'stop' };

  // A coordinate makes it a cell command; the verb (if any) picks the action.
  const coord = voiceFindCoord(tokens, N);
  if (coord) {
    return { type: 'cell', row: coord.row, col: coord.col, action: voiceCellAction(norm) };
  }

  // No coordinate → a global action. Order matters: "zurücksetzen" contains
  // "zurück", so match reset before undo.
  if (/\b(neues? spiel|neustart|neu)\b/.test(norm)) return { type: 'action', action: 'newGame' };
  if (/\b(hinweis|tipp|hilfe)\b/.test(norm)) return { type: 'action', action: 'hint' };
  if (/\b(pr[uü]f\w*|check|kontrolle)\b/.test(norm)) return { type: 'action', action: 'check' };
  if (/\b(zur[uü]cksetzen|reset|alles l[oö]schen|leer\w*|neu anfangen)\b/.test(norm))
    return { type: 'action', action: 'reset' };
  if (/\b(zur[uü]ck|r[uü]ckg[aä]ngig|undo)\b/.test(norm)) return { type: 'action', action: 'undo' };

  return { type: 'none' };
}

// Is the Web Speech API available? Safe to call in Node (returns false).
export function voiceSupported() {
  return (
    typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  );
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
