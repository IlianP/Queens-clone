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
// A SECOND, much smaller store sits next to that top list: the solve
// history (`queens-clone-solves`), one flat array of scores per bucket. The top
// list deliberately throws away everything below its cap (MAX_LOCAL_ENTRIES), so
// it can't answer "how did this solve compare to all the others?" — past the cap
// every result looks alike, whether it just missed the list or came dead last.
// The history keeps just the numbers (no names, no dates) so that relative
// feedback ("besser als 88 % deiner Partien") stays possible for a few bytes
// per solve.
//
// Constraints (this file is concatenated into the classic-script Artifact
// bundle, see tools/build-artifact.mjs): no `import.meta`, and no top-level
// name collisions with the other js/ modules.

export const HINT_PENALTY = 30; // seconds added per hint used
export const MISTAKE_PENALTY = 15; // seconds added per mistake made
// Kept per (size, difficulty) bucket. The list scrolls inside a fixed-height box
// (see .score-list), so a larger cap costs card height nothing — it was 10 only
// because that was the obvious round number, and ten is little once a bucket has
// been played for a while.
export const MAX_LOCAL_ENTRIES = 50;
export const MAX_NAME_LENGTH = 20;

// Solve history: scores per bucket, oldest first, capped. 500 ints is a few kB
// of localStorage at most; past the cap the oldest solves fall off, so the
// percentile becomes "of your last 500" — getPersonalStats reports that via
// `capped` so the UI can say so instead of overclaiming.
export const MAX_SOLVE_HISTORY = 500;
// Below this many previous solves a percentage is more noise than signal
// (1 of 2 games = "besser als 50 %"), so the UI shows a plain placement.
export const MIN_SOLVES_FOR_PERCENTILE = 5;
// Same idea for the global board, where a young bucket has very few entries.
export const MIN_GLOBAL_FOR_PERCENTILE = 20;

const SCORES_KEY = 'queens-clone-highscores';
const SOLVES_KEY = 'queens-clone-solves';

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

// ---------------------------------------------------------------------------
// Solve history — every solve, not just the best few
// ---------------------------------------------------------------------------

// Read the whole history store, dropping anything malformed. Never throws.
export function loadSolveHistory() {
  try {
    const raw = localStorage.getItem(SOLVES_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return {};
    const out = {};
    for (const key of Object.keys(data)) {
      if (!Array.isArray(data[key])) continue;
      const list = data[key]
        .map((v) => Math.round(Number(v)))
        .filter((v) => Number.isFinite(v) && v >= 0);
      out[key] = list.slice(-MAX_SOLVE_HISTORY);
    }
    return out;
  } catch (e) {
    return {};
  }
}

export function getSolveScores(size, difficulty) {
  return loadSolveHistory()[bucketKey(size, difficulty)] || [];
}

// Append one finished solve. Oldest entries fall off at the cap. Returns the
// bucket's new history. Call this exactly once per solve — main.js does it from
// commitPendingWin, the single funnel every finished game passes through.
export function recordSolve(size, difficulty, score) {
  const s = Math.round(Number(score));
  if (!Number.isFinite(s) || s < 0) return getSolveScores(size, difficulty);
  const all = loadSolveHistory();
  const key = bucketKey(size, difficulty);
  const list = (all[key] || []).concat(s).slice(-MAX_SOLVE_HISTORY);
  all[key] = list;
  try {
    localStorage.setItem(SOLVES_KEY, JSON.stringify(all));
  } catch (e) {
    /* storage unavailable (e.g. private mode) — history just won't persist */
  }
  return list;
}

// Backfill empty histories from the top list. Without this, the history is
// empty on every device that played before it existed, so the win card would
// claim "von 2 Partien" right above a full ten-entry list — the numbers visibly
// contradicting each other (the exact symptom this fixes).
//
// The seeded scores are the only past solves still on record, so they are all
// we can offer. Two consequences, both deliberate:
//   * they are the player's BEST ten, not a fair sample, so a percentile against
//     a freshly seeded bucket is pessimistic — it understates how good the new
//     solve was. Real solves dilute that with every game played.
//   * chronological order is unknown; the top-list order is kept, which puts them
//     at the front of the array where the cap evicts first. That is right: they
//     are the oldest thing in there.
//
// Idempotent by construction — a bucket is only seeded while its history is
// empty, and a seeded bucket never becomes empty again — so no migration flag is
// needed, and clearing the history deliberately re-seeds what's left.
// Returns the number of buckets seeded.
export function seedSolveHistory() {
  const history = loadSolveHistory();
  const top = loadLocalScores();
  let seeded = 0;
  for (const key of Object.keys(top)) {
    if (history[key] && history[key].length) continue;
    const scores = top[key].map((e) => e.score).filter((s) => Number.isFinite(s));
    if (!scores.length) continue;
    history[key] = scores.slice(0, MAX_SOLVE_HISTORY);
    seeded++;
  }
  if (seeded) {
    try {
      localStorage.setItem(SOLVES_KEY, JSON.stringify(history));
    } catch (e) {
      /* storage unavailable — the seed just won't persist */
    }
  }
  return seeded;
}

// How much of `others` this score beats, as a percentage (0–100, rounded).
// Pure: `others` are the *other* solves, this score is not among them. A tie
// counts as half a win, the usual percentile-rank convention.
//
// Rounding is nudged away from the extremes: only a score that beats every
// other may read 100 %, only one that beats none may read 0 %. Otherwise
// "besser als 100 % deiner Partien" would show up next to a result that
// actually has a better one above it.
export function percentileBetter(score, others) {
  if (!Array.isArray(others) || others.length === 0) return null;
  let beaten = 0;
  for (const o of others) {
    if (score < o) beaten += 1;
    else if (score === o) beaten += 0.5;
  }
  const pct = Math.round((beaten / others.length) * 100);
  if (pct >= 100 && beaten < others.length) return 99;
  if (pct <= 0 && beaten > 0) return 1;
  return pct;
}

// Everything the win screen needs to describe a fresh solve relative to the
// player's own past ones, computed BEFORE the solve is recorded:
//   total      — previous solves in this bucket (0 on the very first one)
//   rank       — 1-based placement among total + 1, ties resolved in favour of
//                the new solve (same convention as previewRank)
//   percentile — percentileBetter, or null when there are too few to be honest
//   isBest     — a new personal best (strictly better than everything before)
//   bestScore  — the previous best, or null when there wasn't one
//   delta      — |score − bestScore| in seconds, null without a previous best
//   capped     — the history is at its cap, so `total` is "your last N", not all
export function getPersonalStats(size, difficulty, score) {
  const others = getSolveScores(size, difficulty);
  const total = others.length;
  // The all-time best survives in the top list even if the history has
  // rolled past it, so take the better of the two as the record to beat.
  const top = getLocalScores(size, difficulty);
  const candidates = others.concat(top.map((e) => e.score));
  const bestScore = candidates.length ? Math.min(...candidates) : null;
  let rank = 1;
  for (const o of others) if (o < score) rank++;
  return {
    total,
    rank,
    percentile: total >= MIN_SOLVES_FOR_PERCENTILE ? percentileBetter(score, others) : null,
    isBest: bestScore != null && score < bestScore,
    bestScore,
    delta: bestScore == null ? null : Math.abs(score - bestScore),
    capped: total >= MAX_SOLVE_HISTORY,
  };
}

// Find the player's own row in a fetched global top list, so the UI can mark it
// the same way the local list marks a fresh entry. Pure.
//
// The server's rank can't be used as an index directly: submit_score ranks a tie
// on both score and seconds in the new entry's favour, while top_scores orders
// ties by created_at, which puts the newest LAST among them. So match on the
// values instead and, when several rows are identical, take the one closest to
// where the rank said it would be. Returns -1 when the entry isn't in the list
// (rank beyond the fetched limit), which means "don't highlight anything".
export function matchOwnEntry(rows, entry, expectedIndex = -1) {
  if (!Array.isArray(rows) || !entry) return -1;
  let best = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    if (
      sanitizeName(r.name) !== sanitizeName(entry.name) ||
      Number(r.score) !== Number(entry.score) ||
      Number(r.seconds) !== Number(entry.seconds) ||
      Number(r.hints) !== Number(entry.hints) ||
      Number(r.mistakes) !== Number(entry.mistakes)
    )
      continue;
    if (best === -1) best = i;
    else if (
      expectedIndex >= 0 &&
      Math.abs(i - expectedIndex) < Math.abs(best - expectedIndex)
    )
      best = i;
  }
  return best;
}

// The global counterpart: submit_score reports a 1-based `rank` out of `total`
// entries in the bucket (the fresh entry included), which is all a percentage
// needs. Returns null when the bucket is too small for the number to mean
// anything — the caller then shows the plain placement instead.
export function globalPercentile(rank, total) {
  const r = Number(rank);
  const n = Number(total);
  if (!Number.isFinite(r) || !Number.isFinite(n)) return null;
  if (n < MIN_GLOBAL_FOR_PERCENTILE || r < 1 || r > n) return null;
  const others = n - 1; // everyone else in the bucket
  if (others <= 0) return null;
  const pct = Math.round(((others - (r - 1)) / others) * 100);
  if (pct >= 100 && r > 1) return 99;
  if (pct <= 0 && r < n) return 1;
  return pct;
}
