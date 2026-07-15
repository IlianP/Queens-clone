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

// True once both config values are filled in. The UI hides all online controls
// while this is false, so an un-configured build is simply local-only.
export function leaderboardConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

async function rpc(fn, body) {
  if (!leaderboardConfigured()) return null;
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
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null; // offline, blocked, aborted — caller falls back to local
  } finally {
    clearTimeout(timer);
  }
}

// Submit a solved game. Resolves { rank, total } (1-based rank within its
// bucket) or null on any failure. The server sanitises the name, validates the
// values and computes the authoritative score.
export async function submitScore(entry) {
  const data = await rpc('submit_score', {
    p_name: entry.name,
    p_size: entry.size,
    p_difficulty: entry.difficulty,
    p_seconds: entry.seconds,
    p_hints: entry.hints,
    p_mistakes: entry.mistakes,
  });
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
