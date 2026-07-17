// leaderboard.js
// Optional GLOBAL leaderboard over Supabase's auto-generated REST API. This is
// the only file that touches the network; it holds no DOM. Every call fails
// soft: on a missing config, network error, timeout or bad response it resolves
// to null, and the caller falls back to the on-device list — exactly like
// drawLevel() in js/levels.js. The game never depends on this being reachable.
//
// SETUP (once):
//   1. Create a free Supabase project (https://supabase.com).
//   2. Run docs/leaderboard-setup.sql in the project's SQL editor. It creates
//      the `scores` table plus the submit_score / top_scores functions that do
//      the server-side validation (the abuse protection).
//   3. Paste the project URL and the public anon key below.
// Both values are meant to be public — the anon key is designed to ship in the
// browser, and the SQL's Row-Level-Security + SECURITY DEFINER functions are
// what actually protect the data. NEVER put the service_role key here.
//
// Honest limitation: because the browser reports its own solve time, no
// client-fed leaderboard is truly cheat-proof. The server checks reject
// implausible times, bound the counters and best-effort rate-limit — good
// enough for a hobby game, not a tournament.
//
// Constraints (concatenated into the classic-script Artifact bundle): no
// `import.meta`, no top-level name collisions. Inside the Artifact the CSP
// blocks fetch to external hosts, so this stays disabled there and the bundle
// runs local-only — which is the same graceful fallback path.

const SUPABASE_URL = 'https://bnyucmczsxzmsuylawgs.supabase.co'; // no trailing slash
const SUPABASE_ANON_KEY = 'sb_publishable_U83QRj1qXeApAkrEQlsRmA_B2wMBmDy'; // public publishable key
const REQUEST_TIMEOUT_MS = 6000;

// Backoff between retries for a transient submit failure. The first attempt is
// immediate; these are the waits *before* each following attempt, so a submit
// makes up to `RETRY_DELAYS_MS.length + 1` tries (here: 4) before giving up.
// Kept short so a solved player isn't left staring at a spinner. See submitScore
// — a single network blip or cold function start (the symptom this addresses)
// shouldn't lose a hard-won result.
const RETRY_DELAYS_MS = [800, 1600, 3200];

const lbWait = (ms) => new Promise((r) => setTimeout(r, ms));

// True once both config values are filled in. The UI hides all online controls
// while this is false, so an un-configured build is simply local-only.
export function leaderboardConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// One RPC attempt. Returns a discriminated result so a caller can tell a
// transient failure (worth retrying) from a permanent one (don't bother):
//   { ok: true, data }                 — success
//   { ok: false, retriable: boolean }  — failure; retriable on network/timeout,
//                                         a 5xx gateway hiccup or a 429 rate cap.
// A 4xx (bad values, etc.) is permanent — retrying can't change the answer.
async function rpcOnce(fn, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, retriable: res.status >= 500 || res.status === 429 };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, retriable: true }; // offline, blocked, aborted (timeout)
  } finally {
    clearTimeout(timer);
  }
}

// Single-shot, fail-soft to null. Reads use this: per the field report they're
// reliable and a snappy fail is better than a lingering spinner.
async function rpc(fn, body) {
  if (!leaderboardConfigured()) return null;
  const r = await rpcOnce(fn, body);
  return r.ok ? r.data : null;
}

// Retrying variant for writes: retry only transient failures, with backoff.
// `onRetry(nextAttempt, totalAttempts)` (optional) fires before each wait so the
// UI can show progress. Fails soft to null once retries are exhausted or the
// failure is permanent.
async function rpcWithRetry(fn, body, onRetry) {
  if (!leaderboardConfigured()) return null;
  const total = RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; ; attempt++) {
    const r = await rpcOnce(fn, body);
    if (r.ok) return r.data;
    if (!r.retriable || attempt >= RETRY_DELAYS_MS.length) return null;
    if (onRetry) onRetry(attempt + 2, total); // the (1-based) attempt about to run
    await lbWait(RETRY_DELAYS_MS[attempt]);
  }
}

// Submit a solved game. Resolves { rank, total } (1-based rank within its
// bucket) or null on any failure. The server sanitises the name, validates the
// values and computes the authoritative score.
//
// Transient failures are retried with backoff (see rpcWithRetry) instead of
// giving up after a single blip. NOTE: because submit_score has no idempotency
// key server-side, an auto-retry can only be safe when the earlier attempt did
// not reach the database. A rejected/failed attempt didn't insert, so retrying
// is not a duplicate. The lone edge case — the insert succeeded but its response
// was lost — can't be distinguished client-side; the caller (main.js) still
// guards the *manual* retry against ever submitting the same solve twice.
export async function submitScore(entry, { onRetry } = {}) {
  const data = await rpcWithRetry(
    'submit_score',
    {
      p_name: entry.name,
      p_size: entry.size,
      p_difficulty: entry.difficulty,
      p_seconds: entry.seconds,
      p_hints: entry.hints,
      p_mistakes: entry.mistakes,
    },
    onRetry
  );
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.rank == null) return null;
  return { rank: Number(row.rank), total: Number(row.total) };
}

// Fetch the best entries for one (size, difficulty) bucket, best-first.
// Resolves an array (possibly empty) or null when the request fails.
export async function fetchTopScores(size, difficulty, limit = 10) {
  const data = await rpc('top_scores', { p_size: size, p_difficulty: difficulty, p_limit: limit });
  if (!Array.isArray(data)) return null;
  return data.map((r) => ({
    name: r.name,
    seconds: Number(r.seconds),
    hints: Number(r.hints),
    mistakes: Number(r.mistakes),
    score: Number(r.score),
  }));
}
