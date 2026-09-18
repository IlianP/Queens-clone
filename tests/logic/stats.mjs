// Pure-Node test for js/stats.js — the anonymous play counters.
//
// Two things are worth testing here and nothing else really is, because the
// module deliberately does almost nothing:
//
//   1. WHERE A PING SAYS IT COMES FROM. This is the whole mechanism that keeps
//      automated runs out of the real numbers. A Playwright test drives the
//      real UI through the real code, so without a source it would read as a
//      person playing. The rule must also fail CLOSED: an environment the
//      function can't place is never 'web'.
//   2. THAT CLIENT AND SERVER AGREE on the allowed values. bump_stat() drops
//      anything outside its lists SILENTLY (a fire-and-forget client can't act
//      on an error), so a kind added on one side only would look exactly like a
//      feature that works — and count nothing, forever. The check below reads
//      the lists straight out of docs/leaderboard-setup.sql.
//
// Plus the obvious safety property: a counter must never be able to break or
// delay a move, so bumpStat swallows everything and returns nothing.
//
// Run: node tests/logic/stats.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { statsSource, bumpStat, statsEnabled, STAT_KINDS, STAT_SOURCES } from '../../js/stats.js';
import { MIN_SIZE, MAX_SIZE } from '../../js/settings.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL: ' + msg);
};
const eq = (got, want, msg) => {
  if (got !== want) fail(`${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const ok = (cond, msg) => {
  if (!cond) fail(msg);
};

// --- 1) where a ping says it comes from --------------------------------------

const cases = [
  // The live site.
  [{ hostname: 'ilianp.github.io', protocol: 'https:' }, 'web'],
  [{ hostname: 'queens.example.com', protocol: 'https:' }, 'web'],
  // Automation. Checked BEFORE the hostname on purpose: browser tests run
  // against a local server, and tagging them 'dev' would erase the very
  // distinction the source field exists for.
  [{ webdriver: true, hostname: 'ilianp.github.io' }, 'test'],
  [{ webdriver: true, hostname: 'localhost' }, 'test'],
  [{ webdriver: true, protocol: 'file:' }, 'test'],
  // Local development.
  [{ hostname: 'localhost', protocol: 'http:' }, 'dev'],
  [{ hostname: '127.0.0.1', protocol: 'http:' }, 'dev'],
  [{ hostname: '[::1]', protocol: 'http:' }, 'dev'],
  [{ hostname: 'macbook.local', protocol: 'http:' }, 'dev'],
  [{ hostname: 'x', protocol: 'file:' }, 'dev'],
  // Fail closed: nothing recognisable is never 'web'.
  [{}, 'dev'],
  [{ hostname: '', protocol: '' }, 'dev'],
  // An explicit override wins — but only a valid one.
  [{ override: 'test', hostname: 'ilianp.github.io' }, 'test'],
  [{ override: 'dev', webdriver: true }, 'dev'],
  [{ override: 'web', webdriver: true }, 'web'],
  [{ override: 'production', hostname: 'ilianp.github.io' }, 'web'],
  [{ override: 'production' }, 'dev'],
  // `webdriver` is only honoured as a real boolean, never as something truthy
  // that happened to be passed through.
  [{ webdriver: 'false', hostname: 'ilianp.github.io' }, 'web'],
];
for (const [env, want] of cases) {
  eq(statsSource(env), want, `source for ${JSON.stringify(env)}`);
}

// --- 2) client and server agree on the allowed values ------------------------

const sql = readFileSync(join(ROOT, 'docs', 'leaderboard-setup.sql'), 'utf8');
function sqlList(param) {
  const m = new RegExp(`if\\s+${param}\\s+not in \\(([^)]*)\\)`).exec(sql);
  if (!m) return null;
  return m[1].split(',').map((v) => v.trim().replace(/^'|'$/g, '')).sort();
}
const sqlKinds = sqlList('p_kind');
const sqlSources = sqlList('p_source');
ok(sqlKinds, 'bump_stat still validates p_kind in docs/leaderboard-setup.sql');
ok(sqlSources, 'bump_stat still validates p_source in docs/leaderboard-setup.sql');
eq(JSON.stringify(sqlKinds), JSON.stringify([...STAT_KINDS].sort()),
  'STAT_KINDS matches the kinds bump_stat accepts');
eq(JSON.stringify(sqlSources), JSON.stringify([...STAT_SOURCES].sort()),
  'STAT_SOURCES matches the sources bump_stat accepts');
// The one kind that must NOT exist: submissions are counted exactly, once, in
// `scores`. A ping for them would be the same number twice, from two stores
// that can disagree.
ok(!STAT_KINDS.includes('submit') && !STAT_KINDS.includes('submission'),
  'there is no submit ping — that number lives in the scores table');

// The size bound is the third list bump_stat validates, and the only one that
// fails INVISIBLY: an out-of-range size is dropped with a bare `return`, so a
// board size the client can play but the server won't count simply produces no
// counter at all — no error, no log, just a hole in the weekly report. That is
// exactly how sizes 13/14 were first shipped. Both bounds are read out of the
// SQL so they cannot drift from MAX_SIZE again.
const sizeBound = /if v_size <> 0 and \(v_size < (\d+) or v_size > (\d+)\)/.exec(sql);
ok(sizeBound, 'bump_stat still validates the board size in docs/leaderboard-setup.sql');
eq(Number(sizeBound[1]), MIN_SIZE, 'bump_stat accepts down to MIN_SIZE');
eq(Number(sizeBound[2]), MAX_SIZE, 'bump_stat accepts up to MAX_SIZE');

// submit_score and submit_score_v2 carry the same bound, and there it is loud
// (P0001 'bad size', HTTP 400) rather than silent. Both must move together.
const submitBounds = [...sql.matchAll(/if p_size < (\d+) or p_size > (\d+) then raise exception 'bad size'/g)];
eq(submitBounds.length, 2, 'both submit functions still bound the board size');
for (const [i, m] of submitBounds.entries()) {
  eq(Number(m[1]), MIN_SIZE, `submit function ${i + 1} accepts down to MIN_SIZE`);
  eq(Number(m[2]), MAX_SIZE, `submit function ${i + 1} accepts up to MAX_SIZE`);
}

// --- 3) a counter can never break or delay a move ----------------------------

const sent = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  sent.push({ url: String(url), body: JSON.parse(init.body), keepalive: init.keepalive });
  // Even a rejecting transport must not surface anywhere.
  return Promise.reject(new Error('offline'));
};
// Pin the source before the first call: the module resolves it once per page.
globalThis.__QUEENS_STATS_SOURCE = 'test';

eq(bumpStat('game_start', { size: 8, difficulty: 'hard' }), undefined,
  'bumpStat returns nothing — a caller must not be able to await a counter');
eq(sent.length, 1, 'a valid ping is sent');
eq(sent[0].body.p_kind, 'game_start', 'the kind is sent');
eq(sent[0].body.p_source, 'test', 'the resolved source rides along');
eq(sent[0].body.p_size, 8, 'the board size rides along');
eq(sent[0].body.p_difficulty, 'hard', 'the difficulty rides along');
eq(sent[0].keepalive, true, 'the ping survives the page being closed right after a win');
ok(sent[0].url.endsWith('/rest/v1/rpc/bump_stat'), 'the ping goes to bump_stat');
// Nothing identifying is in the payload — that is the entire privacy claim.
eq(Object.keys(sent[0].body).sort().join(','), 'p_difficulty,p_kind,p_size,p_source',
  'a ping carries four fields and nothing else');

bumpStat('app_open');
eq(sent[1].body.p_size, 0, 'a ping with no board reports size 0');
eq(sent[1].body.p_difficulty, '', 'a ping with no board reports no difficulty');

sent.length = 0;
bumpStat('submit', { size: 8, difficulty: 'hard' });
bumpStat('', {});
bumpStat(undefined);
eq(sent.length, 0, 'an unknown kind is never sent');

globalThis.__QUEENS_STATS_OFF = true;
ok(!statsEnabled(), '__QUEENS_STATS_OFF disables the counters');
bumpStat('game_win', { size: 6, difficulty: 'easy' });
eq(sent.length, 0, 'nothing is sent while the counters are off');
delete globalThis.__QUEENS_STATS_OFF;

// A transport that throws synchronously must not reach the caller either.
globalThis.fetch = () => {
  throw new Error('no network stack');
};
eq(bumpStat('game_win', { size: 6, difficulty: 'easy' }), undefined,
  'a throwing transport is swallowed');

globalThis.fetch = originalFetch;
delete globalThis.__QUEENS_STATS_SOURCE;

if (failed) {
  console.error('\nstats: FAILED');
  process.exit(1);
}
console.log('stats: all checks passed');
