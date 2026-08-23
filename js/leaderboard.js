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
//   { ok: true, data }                                    — success
//   { ok: false, retriable, status, error }                — failure;
//     retriable on network/timeout, a 5xx gateway hiccup or a 429 rate cap.
//     `status` is the HTTP status (null for a network-level failure that never
//     got a response); `error` is a short diagnostic string (exception message
//     or response body snippet) for later troubleshooting, never shown to the
//     player — only surfaced via the debug export (see main.js's copySubmitFailureDebug).
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
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch (_) {
        /* body already consumed or unreadable — status alone still helps */
      }
      return {
        ok: false,
        retriable: res.status >= 500 || res.status === 429,
        status: res.status,
        error: detail || res.statusText || null,
      };
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    // offline, blocked (e.g. CSP/CORS), or aborted (timeout) — no HTTP status.
    return { ok: false, retriable: true, status: null, error: e ? `${e.name}: ${e.message}` : String(e) };
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
// UI can show progress. Resolves { ok: true, data, attempts } on success or
// { ok: false, attempts } once retries are exhausted or the failure is
// permanent — `attempts` is every rpcOnce() result in order (status/error/
// retriable), kept so a caller can explain *why* a submit failed, not just that
// it did.
async function rpcWithRetry(fn, body, onRetry) {
  if (!leaderboardConfigured()) return { ok: false, attempts: [] };
  const total = RETRY_DELAYS_MS.length + 1;
  const attempts = [];
  for (let attempt = 0; ; attempt++) {
    const r = await rpcOnce(fn, body);
    attempts.push({ attempt: attempt + 1, status: r.status ?? null, retriable: !!r.retriable, error: r.ok ? null : r.error });
    if (r.ok) return { ok: true, data: r.data, attempts };
    if (!r.retriable || attempt >= RETRY_DELAYS_MS.length) return { ok: false, attempts };
    if (onRetry) onRetry(attempt + 2, total); // the (1-based) attempt about to run
    await lbWait(RETRY_DELAYS_MS[attempt]);
  }
}

// Pull the bare reason out of a PostgREST error body. A `raise exception` in
// submit_score arrives as {"code":"P0001",…,"message":"implausible time"}; a
// non-JSON body (gateway page, plain text) is passed through trimmed. Returns
// null when there's nothing usable. The English strings are the server's own —
// mapping them to player-facing German is the UI's job, not this layer's.
function serverReason(body) {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    const msg = parsed && (parsed.message || parsed.error || parsed.hint);
    if (msg) return String(msg).slice(0, 120);
  } catch (e) {
    /* not JSON — fall through to the raw text */
  }
  return String(body).trim().slice(0, 120) || null;
}

// Submit a solved game. Resolves { rank, total } (1-based rank within its
// bucket) on success. On failure resolves
// { failed: true, rejected, reason, attempts } instead of a bare null so a
// caller can explain why: `rejected` is true when the server answered with a
// permanent 4xx — it refused the values, so retrying is pointless — and `reason`
// is its own short message ("implausible time", "rate limited", …). A
// network/timeout/5xx failure leaves `rejected` false; that one really is
// "unreachable" and worth another try. `attempts` is rpcWithRetry's
// per-try diagnostics (HTTP status / retriable / error text). Callers that
// only care about success can keep testing `res && Number.isFinite(res.rank)`
// unchanged, since a failure object has no `rank`. The server sanitises the
// name, validates the values and computes the authoritative score.
//
// Transient failures are retried with backoff (see rpcWithRetry) instead of
// giving up after a single blip. NOTE: because submit_score has no idempotency
// key server-side, an auto-retry can only be safe when the earlier attempt did
// not reach the database. A rejected/failed attempt didn't insert, so retrying
// is not a duplicate. The lone edge case — the insert succeeded but its response
// was lost — can't be distinguished client-side; the caller (main.js) still
// guards the *manual* retry against ever submitting the same solve twice.
export async function submitScore(entry, { onRetry } = {}) {
  const result = await rpcWithRetry(
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
  if (!result.ok) {
    // Separate "the server said no" from "the server never answered". Both used
    // to surface as "nicht erreichbar", which sent a player hunting for a network
    // problem when submit_score had in fact rejected the values (a fast solve
    // tripping the old plausibility floor is the case that exposed this).
    const last = result.attempts[result.attempts.length - 1];
    const rejected = !!last && !last.retriable && last.status >= 400 && last.status < 500;
    return {
      failed: true,
      rejected,
      reason: rejected ? serverReason(last.error) : null,
      attempts: result.attempts,
    };
  }
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row || row.rank == null) return { failed: true, attempts: result.attempts, error: 'unexpected response shape' };
  return { rank: Number(row.rank), total: Number(row.total) };
}

// How many global rows to fetch by default. `top_scores` clamps p_limit to 100
// server-side, so this stays well inside what the RPC allows; the bucket index
// covers the ORDER BY, so 50 rows is the same index scan as 10 with a different
// LIMIT (~3 kB of JSON). Both leaderboard views scroll, so more rows cost no
// layout either.
export const TOP_SCORES_LIMIT = 50;

// Fetch the best entries for one (size, difficulty) bucket, best-first.
// Resolves an array (possibly empty) or null when the request fails.
//
// `since` (epoch ms or null) restricts the list to entries submitted after that
// moment — the time-scoped board. It is only sent when set, and that matters:
// against a database where docs/leaderboard-setup.sql has NOT been re-run, the
// four-argument top_scores doesn't exist and PostgREST answers 404. Omitting the
// parameter keeps the plain all-time call byte-for-byte what it always was, so
// an un-migrated project keeps working exactly as before (see fetchBucketCounts,
// which is what gates the time-scoped view in the first place).
//
// `at` is the row's submission time in epoch ms, or null — an un-migrated
// top_scores doesn't return created_at, and the UI then simply shows no age.
export async function fetchTopScores(size, difficulty, { limit = TOP_SCORES_LIMIT, since = null } = {}) {
  const body = { p_size: size, p_difficulty: difficulty, p_limit: limit };
  if (since != null) body.p_since = new Date(since).toISOString();
  const data = await rpc('top_scores', body);
  if (!Array.isArray(data)) return null;
  return data.map((r) => ({
    name: r.name,
    seconds: Number(r.seconds),
    hints: Number(r.hints),
    mistakes: Number(r.mistakes),
    score: Number(r.score),
    at: r.created_at ? Date.parse(r.created_at) : null,
  }));
}

// How full a bucket is, all-time and within the last `since` window:
// { total, recent }. This is what makes the time-scoped view *adaptive* — a
// month tab over three entries is worse than no tab at all, so the UI asks first
// and only offers it where the window actually holds a field (see
// MIN_PERIOD_ENTRIES in main.js).
//
// Fails soft to null like every read here, which doubles as the feature gate: a
// project whose SQL predates score_counts answers 404, the caller sees null and
// simply never offers the view. No version handshake, no config flag.
export async function fetchBucketCounts(size, difficulty, since) {
  const data = await rpc('score_counts', {
    p_size: size,
    p_difficulty: difficulty,
    p_since: new Date(since).toISOString(),
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.total == null) return null;
  return { total: Number(row.total), recent: Number(row.recent) };
}
