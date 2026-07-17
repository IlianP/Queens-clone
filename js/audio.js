// audio.js
// Minimalist sound effects, synthesised on the fly with the Web Audio API — no
// audio files to ship, so it stays true to the project's "no build step, no
// dependencies" rule and works inside the Artifact's strict CSP too (nothing is
// fetched). This is an audio layer only: it never touches the DOM (main.js
// wires it), mirroring how leaderboard.js is a network-only layer.
//
// Browsers only allow an AudioContext to make sound after a user gesture, so the
// context is created lazily on the first sound and resumed if the browser
// suspended it. Muting is a pure in-memory flag flipped by main.js from the
// persisted `sound` preference; a muted call is a cheap no-op that never even
// spins up the context.

let ctx = null;
let master = null;
let muted = false;

// Lazily create (and resume) the shared AudioContext + master gain. Returns null
// when Web Audio isn't available or the context can't start, so every play* call
// fails soft and the game is never blocked by audio.
function ensureContext() {
  if (muted) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    // A context can start "suspended" (autoplay policy) or get suspended when
    // the tab is backgrounded — resume() inside the user gesture wakes it.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch (e) {
    return null;
  }
}

// One shaped oscillator "voice": a short note with a quick attack and an
// exponential decay so nothing clicks or lingers. Times are seconds relative to
// the context clock; `when` offsets a note for little arpeggios.
function voice(ac, { freq, type = 'sine', dur = 0.12, gain = 0.2, when = 0, attack = 0.005 }) {
  const t0 = ac.currentTime + when;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  // Attack up to `gain`, then an exponential fall to near-silence by t0 + dur.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Play a small set of voices as one effect. Silent (and allocation-free) while
// muted or when the context can't start.
function play(notes) {
  const ac = ensureContext();
  if (!ac) return;
  for (const n of notes) voice(ac, n);
}

export function setMuted(value) {
  muted = !!value;
}

export function isMuted() {
  return muted;
}

// ---------- The sounds (deliberately understated) ----------

// Placing a queen: a bright, satisfying pluck (a note + its octave).
export function playPlace() {
  play([
    { freq: 660, type: 'triangle', dur: 0.14, gain: 0.22 },
    { freq: 990, type: 'sine', dur: 0.1, gain: 0.12, when: 0.005 },
  ]);
}

// Dotting a cell: a soft, short tick.
export function playDot() {
  play([{ freq: 340, type: 'sine', dur: 0.06, gain: 0.13 }]);
}

// Clearing a cell back to empty: a lower, muted tick.
export function playErase() {
  play([{ freq: 200, type: 'sine', dur: 0.07, gain: 0.11 }]);
}

// Asking for a hint: a gentle two-note lift.
export function playHint() {
  play([
    { freq: 587, type: 'sine', dur: 0.12, gain: 0.14 },
    { freq: 880, type: 'sine', dur: 0.16, gain: 0.14, when: 0.09 },
  ]);
}

// Menu / control clicks: a discreet, low-key blip.
export function playUi() {
  play([{ freq: 420, type: 'triangle', dur: 0.05, gain: 0.1 }]);
}

// Solving the puzzle: a short rising major arpeggio (C–E–G–C).
export function playWin() {
  play([
    { freq: 523.25, type: 'triangle', dur: 0.22, gain: 0.2, when: 0.0 },
    { freq: 659.25, type: 'triangle', dur: 0.22, gain: 0.2, when: 0.1 },
    { freq: 783.99, type: 'triangle', dur: 0.22, gain: 0.2, when: 0.2 },
    { freq: 1046.5, type: 'triangle', dur: 0.42, gain: 0.22, when: 0.32 },
  ]);
}
