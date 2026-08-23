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
// history (`queens-clone-solves`), one flat array per bucket. The top list
// deliberately throws away everything below its cap (MAX_LOCAL_ENTRIES), so it
// can't answer "how did this solve compare to all the others?" — past the cap
// every result looks alike, whether it just missed the list or came dead last.
// The history keeps only what such a comparison needs (no names) so that
// relative feedback ("besser als 88 % deiner Partien") stays possible for a few
// bytes per solve.
//
// A history entry is stored in one of two shapes, and both are read:
//   [score, timestampMs]  — a dated solve (what recordSolve writes today)
//   score                 — an UNDATED solve: written by the pre-dating build,
//                           or backfilled from a top-list entry that has no date
// Dates arrived later than the history itself, so "undated" is a permanent part
// of the format, not a migration step: those solves can never be placed on a
// timeline. Everything time-scoped (see RECENT_WINDOW_DAYS) therefore counts
// dated solves only, while the all-time figures count every solve — an undated
// solve still happened, it just happened at an unknown time.
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

// The rolling window behind the time-scoped half of the personal feedback
// ("besser als 92 % deiner Partien der letzten 30 Tage"). Rolling rather than
// calendar-based on purpose: a calendar month is empty on the 1st and full on
// the 28th, so the same solve would read very differently depending on the date.
// One constant — widen it here and every surface follows.
export const RECENT_WINDOW_DAYS = 30;
export const RECENT_WINDOW_MS = RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
// Fewer dated solves than this inside the window and there is nothing to compare
// against — the window line is dropped rather than shown over a field of two.
export const MIN_RECENT_SOLVES = 3;

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
//
// TIES DO NOT OVERTAKE: an equally good entry that is already on the list keeps
// its place, and the fresh one goes behind it. That is not a detail — it is what
// saveLocalScore does (it pushes the new entry and sorts with a *stable* sort,
// so an exact tie stays last), and a preview that put the row first instead made
// the list visibly re-sort itself the moment the score was saved. Same rule as
// the global list, where top_scores orders ties by created_at ascending.
//
// `seconds` mirrors byScore's tie-break; leaving it out keeps the old
// score-only behaviour for callers that don't have it.
export function previewRank(size, difficulty, score, seconds = null) {
  const list = getLocalScores(size, difficulty);
  let rank = 0;
  for (const e of list) {
    const better =
      e.score < score ||
      (e.score === score && (seconds == null || e.seconds <= seconds));
    if (better) rank++;
    else break;
  }
  return rank;
}

// ---------------------------------------------------------------------------
// Solve history — every solve, not just the best few
// ---------------------------------------------------------------------------

// One history entry, canonical form: a score plus when it was solved, or null
// when that is unknown (see the format note at the top of this file). Returns
// null for anything unusable, which is how junk is dropped on read.
function normalizeSolve(v) {
  const pair = Array.isArray(v);
  const score = Math.round(Number(pair ? v[0] : v));
  if (!Number.isFinite(score) || score < 0) return null;
  const raw = pair ? Number(v[1]) : NaN;
  // A timestamp is only kept when it is a plausible epoch-ms value; anything
  // else (0, a bare year, NaN) reads as "undated" rather than as 1970.
  const at = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  return { score, at };
}

// Back to storage shape: dated solves as [score, at], undated as a bare number,
// so a history written before dates existed round-trips unchanged.
function serializeSolve(e) {
  return e.at == null ? e.score : [e.score, e.at];
}

// Read the whole history store, dropping anything malformed. Never throws.
// Returns { bucketKey: Solve[] } with Solve = { score, at } — see normalizeSolve.
export function loadSolveHistory() {
  try {
    const raw = localStorage.getItem(SOLVES_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return {};
    const out = {};
    for (const key of Object.keys(data)) {
      if (!Array.isArray(data[key])) continue;
      const list = data[key].map(normalizeSolve).filter(Boolean);
      out[key] = list.slice(-MAX_SOLVE_HISTORY);
    }
    return out;
  } catch (e) {
    return {};
  }
}

function saveSolveHistory(history) {
  const out = {};
  for (const key of Object.keys(history)) out[key] = history[key].map(serializeSolve);
  try {
    localStorage.setItem(SOLVES_KEY, JSON.stringify(out));
  } catch (e) {
    /* storage unavailable (e.g. private mode) — history just won't persist */
  }
}

// The dated form: every solve in a bucket with its timestamp (null when
// unknown), oldest first.
export function getSolveEntries(size, difficulty) {
  return loadSolveHistory()[bucketKey(size, difficulty)] || [];
}

// The scores alone, which is all the all-time comparisons need.
export function getSolveScores(size, difficulty) {
  return getSolveEntries(size, difficulty).map((e) => e.score);
}

// Append one finished solve. Oldest entries fall off at the cap. Returns the
// bucket's new history as Solve[]. Call this exactly once per solve — main.js
// does it from commitPendingWin, the single funnel every finished game passes
// through. `at` is injectable so tests can lay out a history over time.
export function recordSolve(size, difficulty, score, at = Date.now()) {
  const entry = normalizeSolve([score, at]);
  if (!entry) return getSolveEntries(size, difficulty);
  const all = loadSolveHistory();
  const key = bucketKey(size, difficulty);
  const list = (all[key] || []).concat(entry).slice(-MAX_SOLVE_HISTORY);
  all[key] = list;
  saveSolveHistory(all);
  return list;
}

// Fold a bucket's top-list entries into its history, adding only the solves the
// history doesn't already account for. Pure. Both arguments accept either form
// of a solve — a bare score, a [score, at] pair, or a top-list Entry
// ({ score, date }) — and the result is always canonical Solve[].
//
// The two stores overlap: every solve since the history existed was written to
// BOTH, so concatenating them would count those games twice and skew every
// percentile. They also each hold something the other lost — the top list keeps
// old solves from before the history existed, the history keeps solves that fell
// off the top list's cap. So the merge is a multiset union: per score value keep
// `max(count in history, count in top list)`, i.e. add a top-list score only as
// often as it appears there beyond the history's own copies.
//
// The one case this gets wrong is two genuinely different solves with an
// identical score, one recorded only in the history and one only in the top
// list: they collapse into one. That undercounts by a single game; the
// alternative (double-counting every shared solve) is far worse.
//
// Extras go to the FRONT: their chronological position is unknown, but they are
// certainly older than anything the history recorded itself, and the front is
// where the cap evicts first — so a full history of real solves is never
// displaced by best-biased backfill. That ordering is about eviction, not about
// time: a backfilled entry keeps its own date (top-list entries have one), which
// is what lets a freshly seeded device answer "the last 30 days" at all.
export function mergeSolveSamples(history, topScores) {
  const clean = (list) =>
    (Array.isArray(list) ? list : [])
      .map((v) => (v && typeof v === 'object' && !Array.isArray(v) ? entryToSolve(v) : normalizeSolve(v)))
      .filter(Boolean);
  const hist = clean(history);
  const top = clean(topScores);
  if (!top.length) return hist;
  const have = new Map();
  for (const e of hist) have.set(e.score, (have.get(e.score) || 0) + 1);
  const seen = new Map();
  const extra = [];
  for (const e of top) {
    const n = (seen.get(e.score) || 0) + 1;
    seen.set(e.score, n);
    if (n > (have.get(e.score) || 0)) extra.push(e);
  }
  if (!extra.length) return hist;
  return extra.concat(hist).slice(-MAX_SOLVE_HISTORY);
}

// A top-list Entry ({ score, date: ISO string }) as a history Solve. The date is
// the moment the entry was saved, i.e. the moment it was solved — normalizeEntry
// stamps it on write — so a backfilled solve lands on the timeline correctly.
function entryToSolve(entry) {
  // `date` is the top list's ISO string, `at` the history's epoch-ms — accept
  // both so a canonical Solve can be merged back in without losing its date.
  const raw = entry.date != null ? entry.date : entry.at;
  const at = typeof raw === 'string' ? Date.parse(raw) : Number(raw);
  return normalizeSolve([entry.score, at]);
}

// Backfill histories from the top list. Without this, the history is empty on
// every device that played before it existed, so the win card would claim "von 2
// Partien" right above a full ten-entry list — the numbers visibly contradicting
// each other (the exact symptom this fixes).
//
// Buckets are topped up rather than only seeded when empty: a device that played
// a few games after the history shipped but before this backfill did would
// otherwise keep comparing against those few games forever, while the list below
// the card shows every older solve. `mergeSolveSamples` is what makes topping up
// safe — see there for why the two stores can't simply be concatenated.
//
// The recovered scores are the only past solves still on record, so they are all
// we can offer, and they are the player's BEST ones rather than a fair sample:
// a percentile against a freshly backfilled bucket is pessimistic — it
// understates how good the new solve was. Real solves dilute that with every
// game played. Anything that fell off the top list before it held 50 entries is
// gone for good, so the count stays a lower bound on the games really played.
//
// Idempotent by construction — a second run finds every top-list score already
// accounted for (and a run truncated by the cap stays truncated, since the merge
// then returns a list of unchanged length) — so no migration flag is needed, and
// clearing the history deliberately re-seeds what's left.
// Returns the number of buckets changed.
export function seedSolveHistory() {
  const history = loadSolveHistory();
  const top = loadLocalScores();
  let seeded = 0;
  for (const key of Object.keys(top)) {
    // Entries, not bare scores: the top list carries the solve date, and that
    // date is the only way a pre-existing solve can join a time window.
    const entries = top[key].filter((e) => Number.isFinite(e.score));
    if (!entries.length) continue;
    const before = history[key] || [];
    const merged = mergeSolveSamples(before, entries);
    if (merged.length === before.length) continue;
    history[key] = merged;
    seeded++;
  }
  if (seeded) saveSolveHistory(history);
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

// Placement of `score` within a field of other scores: 1-based rank (ties in
// favour of the new solve, the same convention as previewRank) plus the
// percentile, suppressed while the field is too small to mean anything.
function placeAmong(score, others) {
  let rank = 1;
  for (const o of others) if (o < score) rank++;
  return {
    total: others.length,
    rank,
    percentile: others.length >= MIN_SOLVES_FOR_PERCENTILE ? percentileBetter(score, others) : null,
  };
}

// Everything the win screen needs to describe a fresh solve relative to the
// player's own past ones, computed BEFORE the solve is recorded:
//   total      — previous solves in this bucket (0 on the very first one)
//   rank       — 1-based placement among total + 1, ties resolved in favour of
//                the new solve. Deliberately the opposite of previewRank /
//                matchOwnEntry: those place a row in a list the player is looking
//                at, so a tie must not jump over the entry it matched, while this
//                number stands on its own and reads as encouragement
//   percentile — percentileBetter, or null when there are too few to be honest
//   isBest     — a new personal best (strictly better than everything before)
//   bestScore  — the previous best, or null when there wasn't one
//   delta      — |score − bestScore| in seconds, null without a previous best
//   capped     — the history is at its cap, so `total` is "your last N", not all
//   recent     — the same picture over the last RECENT_WINDOW_DAYS days, or null
//                when it wouldn't say anything (see below)
//
// `recent` is deliberately absent more often than present. It is dropped when
// the window holds fewer than MIN_RECENT_SOLVES dated solves (nothing to compare
// against), and — just as important — when the window covers every solve on
// record: a player whose games are all from the last month would otherwise get
// two lines saying the same thing in different words. So it appears exactly when
// it adds information the all-time figures don't already carry.
export function getPersonalStats(size, difficulty, score, { now = Date.now(), windowMs = RECENT_WINDOW_MS } = {}) {
  const entries = getSolveEntries(size, difficulty);
  const others = entries.map((e) => e.score);
  const all = placeAmong(score, others);
  // The all-time best survives in the top list even if the history has
  // rolled past it, so take the better of the two as the record to beat.
  const top = getLocalScores(size, difficulty);
  const candidates = others.concat(top.map((e) => e.score));
  const bestScore = candidates.length ? Math.min(...candidates) : null;

  const since = now - windowMs;
  const inWindow = entries.filter((e) => e.at != null && e.at >= since).map((e) => e.score);
  let recent = null;
  if (inWindow.length >= MIN_RECENT_SOLVES && inWindow.length < entries.length) {
    const place = placeAmong(score, inWindow);
    const windowBest = Math.min(...inWindow);
    recent = {
      ...place,
      days: Math.round(windowMs / (24 * 60 * 60 * 1000)),
      isBest: score < windowBest,
      bestScore: windowBest,
      delta: Math.abs(score - windowBest),
    };
  }

  return {
    total: all.total,
    rank: all.rank,
    percentile: all.percentile,
    isBest: bestScore != null && score < bestScore,
    bestScore,
    delta: bestScore == null ? null : Math.abs(score - bestScore),
    capped: all.total >= MAX_SOLVE_HISTORY,
    dated: entries.filter((e) => e.at != null).length,
    recent,
  };
}

// Find the player's own row in a fetched global top list, so the UI can mark it
// the same way the local list marks a fresh entry. Pure. Returns -1 when the
// entry isn't in the list (rank beyond the fetched limit), which means "don't
// highlight anything".
//
// Rows are matched on their values, and when SEVERAL rows carry the same values
// — a genuine tie with another player, or the same solve submitted twice — the
// one that was inserted LAST is ours: our row is the newest by definition, and
// top_scores orders ties by created_at ascending, so it sits at the end of the
// tied run. The timestamp says so directly; without one (a server that predates
// created_at in the response) the last matching position says the same thing.
//
// The server's rank must NOT be used to pick between them, which is the bug this
// replaced: submit_score ranked a tie in the new entry's favour, so the rank
// pointed at the FIRST row of the tied run while the list had ours at the END —
// the highlight then sat one row above the entry that had just been submitted.
// (submit_score now ranks by the same rule, but the client can't assume a
// database has been migrated, and with this rule it doesn't need to.)
export function matchOwnEntry(rows, entry) {
  if (!Array.isArray(rows) || !entry) return -1;
  const matches = [];
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
    matches.push(i);
  }
  if (matches.length <= 1) return matches.length ? matches[0] : -1;
  const dated = matches.filter((i) => Number.isFinite(rows[i].at));
  if (dated.length) return dated.reduce((a, b) => (rows[b].at >= rows[a].at ? b : a));
  return matches[matches.length - 1];
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
