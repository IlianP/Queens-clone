// stats.js
// Anonyme Spielzähler ("Pings"). The leaderboard only ever learns about games
// that were solved AND submitted; everything before that — opened, started,
// solved-but-not-submitted — was invisible. This layer closes that gap for the
// weekly activity report (tools/weekly-report.mjs).
//
// What it sends is a COUNTER BUMP, not an event: the server (`bump_stat` in
// docs/leaderboard-setup.sql) adds one to a row keyed by hour, kind, source,
// size and difficulty. There is no row per game, no IP, no client id, no
// session, no cookie, no storage — nothing that could be tied back to a person,
// because nothing identifying is ever sent. That is also why this module keeps
// no state beyond the resolved source.
//
// SEPARATE FROM THE LEADERBOARD, on purpose: submissions are counted by
// `scores` and pings by `play_stats`, and the two are never added together.
// There is deliberately no `submit` kind — that number already exists, exactly,
// one table over. The kinds form a funnel instead:
//
//   app_open → game_start → game_win → (submission, from `scores`)
//
// SOURCE is what keeps automated runs out of the real figures. A Playwright
// test drives a real browser through the real code, so it would otherwise count
// as somebody playing. `navigator.webdriver` is set by every WebDriver/CDP
// automation stack, so test traffic tags itself as 'test' without a single test
// file having to opt in — and a forgotten flag can't leak a test run into the
// 'web' numbers. Local development tags itself 'dev' the same way, from the
// hostname. The report only counts 'web' and lists the rest separately.
//
// Layering: network only, no DOM, fails soft everywhere — a ping is never
// awaited and can never delay or break a move. Mirrors js/leaderboard.js.
// Bundle constraints apply (it is concatenated into the classic-script
// Artifact): no `import.meta`, no top-level name collisions. In the Artifact
// the CSP blocks fetch entirely, so every ping simply fails silently there.
import { SUPABASE_URL, SUPABASE_ANON_KEY, leaderboardConfigured } from './leaderboard.js';

// Must match the check inside bump_stat(); anything else is dropped server-side.
export const STAT_KINDS = ['app_open', 'game_start', 'game_win'];
export const STAT_SOURCES = ['web', 'test', 'dev'];

const STAT_TIMEOUT_MS = 4000;

// Pure: decide where a ping comes from. Takes the environment as data so Node
// can test every branch (js/voice.js's parser layering, one level smaller).
//
// Order matters. `webdriver` is checked BEFORE the hostname because browser
// tests run against a local server: they are test traffic first and local
// traffic only incidentally, and tagging them 'dev' would hide exactly the
// distinction this is for.
export function statsSource(env = {}) {
  const override = String(env.override || '');
  if (STAT_SOURCES.includes(override)) return override;
  if (env.webdriver === true) return 'test';
  const protocol = String(env.protocol || '');
  const hostname = String(env.hostname || '');
  // Fail closed: an environment this can't place (no hostname, a file:// copy,
  // an unknown override) is 'dev', never 'web'. Miscounting a real player as
  // development costs one tick; miscounting a robot as a player is what the
  // whole source field exists to prevent.
  if (protocol === 'file:' || hostname === '') return 'dev';
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' ||
      hostname === '::1' || hostname.endsWith('.local') || hostname.endsWith('.localhost')) {
    return 'dev';
  }
  return 'web';
}

// Read the environment once. A page doesn't change its hostname, and re-reading
// per ping would only add ways to disagree with itself mid-session.
let resolvedSource = null;
function currentSource() {
  if (resolvedSource) return resolvedSource;
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  const loc = typeof location === 'undefined' ? {} : location;
  const glob = typeof globalThis === 'undefined' ? {} : globalThis;
  resolvedSource = statsSource({
    // Escape hatch for a test that wants to state its source explicitly (or a
    // trial build that should count as neither). Unknown values are ignored.
    override: glob.__QUEENS_STATS_SOURCE,
    webdriver: nav.webdriver === true,
    protocol: loc.protocol,
    hostname: loc.hostname,
  });
  return resolvedSource;
}

// Set once the server has said it has no counters (404) or won't take them
// (401/403). Without this every game would re-ask a question already answered
// and log another failed request — on a database where the migration simply
// hasn't been run yet, which is the documented state before setup. One attempt
// per page load is enough to find out.
let serverRefused = false;

// True when pings can be sent at all. `__QUEENS_STATS_OFF` turns them off
// completely — for a run that should leave no trace at all, not even a 'test'
// one. Without leaderboard config there is no server to talk to.
export function statsEnabled() {
  const glob = typeof globalThis === 'undefined' ? {} : globalThis;
  return !serverRefused && !glob.__QUEENS_STATS_OFF && leaderboardConfigured();
}

// Fire-and-forget. Returns nothing on purpose: a caller must not be able to
// await it, because a counter must never sit in front of a move. Every failure
// path — unconfigured, offline, CSP, 404 on a database where the migration
// hasn't run — ends in the same silent catch.
export function bumpStat(kind, opts = {}) {
  try {
    if (!statsEnabled() || !STAT_KINDS.includes(kind)) return;
    const size = Number.isFinite(opts.size) ? opts.size : 0;
    const difficulty = typeof opts.difficulty === 'string' ? opts.difficulty : '';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), STAT_TIMEOUT_MS);
    fetch(`${SUPABASE_URL}/rest/v1/rpc/bump_stat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        p_kind: kind,
        p_source: currentSource(),
        p_size: size,
        p_difficulty: difficulty,
      }),
      signal: ctrl.signal,
      // Survives the page being closed right after a win — the one ping that
      // would otherwise be cancelled by the navigation it follows.
      keepalive: true,
    })
      .then((res) => {
        if (res && (res.status === 404 || res.status === 401 || res.status === 403)) {
          serverRefused = true;
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  } catch {
    // Nothing a player does should ever be interrupted by a counter.
  }
}
