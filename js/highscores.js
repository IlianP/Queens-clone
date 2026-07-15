// highscores.js
// Local best-times AND the shared score model used by both the on-device list
// and the optional online leaderboard. Pure logic, no DOM.
//
// Storage: one localStorage key `queens-clone-highscores`, shaped
//   { "<size>-<difficulty>": Entry[] }   // Entry sorted best-first, capped
// where Entry = { name, seconds, hints, mistakes, score, date }. Each
// (size, difficulty) pair is its own leaderboard — the granularity the game
// already exposes (sizes 5–11 × easy/medium/hard, plus 12×hard).
//
// The "score" is an *effective time in seconds*: the raw solve time plus a
// penalty per used hint and per mistake, so faster/cleaner solves rank higher.
// Keeping the raw components lets the penalties be re-tuned without a data
// migration — and the same formula is mirrored server-side in
// docs/leaderboard-setup.sql, so keep the two in sync.
//
// Constraints (this file is concatenated into the classic-script Artifact
// bundle, see tools/build-artifact.mjs): no `import.meta`, and no top-level
// name collisions with the other js/ modules.

export const HINT_PENALTY = 30; // seconds added per hint used
export const MISTAKE_PENALTY = 15; // seconds added per mistake made
export const MAX_LOCAL_ENTRIES = 10; // kept per (size, difficulty) bucket
export const MAX_NAME_LENGTH = 20;

const SCORES_KEY = 'queens-clone-highscores';

export function bucketKey(size, difficulty) {
  return `${size}-${difficulty}`;
}

// Effective time in whole seconds; lower is better. Mirrors queens_score() in
// docs/leaderboard-setup.sql.
export function computeScore(seconds, hints = 0, mistakes = 0) {
  return Math.round(seconds + HINT_PENALTY * hints + MISTAKE_PENALTY * mistakes);
}

export function sanitizeName(name) {
  return String(name == null ? '' : name)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

// Order best-first: lower score, then the faster raw time as a tie-break.
function byScore(a, b) {
  return a.score - b.score || a.seconds - b.seconds;
}

// Coerce a stored/candidate entry into a clean Entry, or null if unusable.
function normalizeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const seconds = Math.floor(Number(e.seconds));
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const hints = Number.isFinite(Number(e.hints)) ? Math.max(0, Math.floor(Number(e.hints))) : 0;
  const mistakes = Number.isFinite(Number(e.mistakes))
    ? Math.max(0, Math.floor(Number(e.mistakes)))
    : 0;
  const score = Number.isFinite(Number(e.score)) ? Math.round(Number(e.score)) : computeScore(seconds, hints, mistakes);
  return {
    name: sanitizeName(e.name),
    seconds,
    hints,
    mistakes,
    score,
    date: typeof e.date === 'string' ? e.date : new Date().toISOString(),
  };
}

// Read the whole store, dropping anything malformed. Never throws.
export function loadLocalScores() {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return {};
    const out = {};
    for (const key of Object.keys(data)) {
      if (!Array.isArray(data[key])) continue;
      const list = data[key].map(normalizeEntry).filter(Boolean);
      list.sort(byScore);
      out[key] = list.slice(0, MAX_LOCAL_ENTRIES);
    }
    return out;
  } catch (e) {
    return {};
  }
}

export function getLocalScores(size, difficulty) {
  return loadLocalScores()[bucketKey(size, difficulty)] || [];
}

// Insert an entry into its bucket, keep the list sorted and capped, persist it,
// and report where the new entry landed. Returns { list, rank } with a
// 0-based rank, or rank === -1 when the entry didn't make the top N.
export function saveLocalScore(size, difficulty, entry) {
  const norm = normalizeEntry(entry);
  if (!norm) return { list: getLocalScores(size, difficulty), rank: -1 };
  const all = loadLocalScores();
  const key = bucketKey(size, difficulty);
  const list = all[key] ? all[key].slice() : [];
  list.push(norm);
  list.sort(byScore);
  const trimmed = list.slice(0, MAX_LOCAL_ENTRIES);
  const rank = trimmed.indexOf(norm);
  all[key] = trimmed;
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(all));
  } catch (e) {
    /* storage unavailable (e.g. private mode) — the list just won't persist */
  }
  return { list: trimmed, rank };
}

// Where a hypothetical entry would rank in a bucket without saving it — used to
// preview a fresh win's placement in the local list before it's committed.
export function previewRank(size, difficulty, score) {
  const list = getLocalScores(size, difficulty);
  let rank = 0;
  for (const e of list) {
    if (e.score < score) rank++;
    else break;
  }
  return rank;
}
