// Pure-Node test for the READ half of js/leaderboard.js — the time-scoped
// leaderboard: fetchTopScores' optional `since` window and the created_at that
// rides along with every row, plus fetchBucketCounts behind the adaptive tab.
//
// Like its sibling leaderboard-retry.mjs this replaces the global `fetch` with a
// scripted mock, so the live Supabase project is never contacted.
//
// The promise under test is compatibility as much as function: a project whose
// docs/leaderboard-setup.sql has NOT been re-run has no four-argument
// top_scores and no score_counts at all. The all-time call must therefore go out
// byte-for-byte as before (no p_since), and everything time-scoped must fail
// soft to null so the UI can simply not offer it.
//
// Run: node tests/logic/leaderboard-period.mjs

import { fetchTopScores, fetchBucketCounts, TOP_SCORES_LIMIT } from '../../js/leaderboard.js';

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL: ' + msg);
};
const eq = (got, want, msg) => {
  if (got !== want) fail(`${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// Records every call as { url, body } and answers with the given step.
function installFetch(step) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse((init && init.body) || '{}') });
    if (step.throw) throw new Error('network down');
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      statusText: `status ${step.status}`,
      json: async () => step.body,
      text: async () => JSON.stringify(step.body),
    };
  };
  return calls;
}

const realFetch = globalThis.fetch;
const ROW = {
  name: 'Tester',
  seconds: 42,
  hints: 1,
  mistakes: 0,
  score: 72,
  created_at: '2026-08-01T10:00:00+00:00',
};

try {
  // 1) All-time read: the request body is exactly the pre-feature one. A p_since
  //    key here would 404 against an un-migrated database and take the whole
  //    global tab down with it.
  {
    const calls = installFetch({ status: 200, body: [ROW] });
    const rows = await fetchTopScores(9, 'hard');
    eq(calls.length, 1, 'one request');
    eq(calls[0].url.endsWith('/rest/v1/rpc/top_scores'), true, 'hits the top_scores RPC');
    eq(
      JSON.stringify(Object.keys(calls[0].body).sort()),
      '["p_difficulty","p_limit","p_size"]',
      'no p_since is sent for the all-time list'
    );
    eq(calls[0].body.p_limit, TOP_SCORES_LIMIT, 'default limit');
    eq(rows.length, 1, 'one row parsed');
    eq(rows[0].score, 72, 'score parsed');
    eq(rows[0].at, Date.parse('2026-08-01T10:00:00Z'), 'created_at becomes epoch ms');
  }

  // 2) A row without created_at (an un-migrated top_scores) parses fine and
  //    simply has no timestamp — the UI then shows no age for it.
  {
    installFetch({ status: 200, body: [{ name: 'Alt', seconds: 30, hints: 0, mistakes: 0, score: 30 }] });
    const rows = await fetchTopScores(9, 'hard');
    eq(rows[0].at, null, 'a row without created_at reads as undated');
    eq(rows[0].name, 'Alt', 'the rest of the row is unaffected');
  }

  // 3) The windowed read sends p_since as an ISO timestamp, and a custom limit.
  {
    const since = Date.parse('2026-06-01T00:00:00Z');
    const calls = installFetch({ status: 200, body: [ROW] });
    await fetchTopScores(11, 'medium', { since, limit: 25 });
    eq(calls[0].body.p_since, new Date(since).toISOString(), 'p_since is sent as ISO');
    eq(calls[0].body.p_limit, 25, 'the limit is passed through');
    eq(calls[0].body.p_size, 11, 'bucket size');
    eq(calls[0].body.p_difficulty, 'medium', 'bucket difficulty');
  }

  // 4) fetchBucketCounts: the numbers behind the adaptive tab.
  {
    const calls = installFetch({ status: 200, body: [{ total: 34, recent: 9 }] });
    const counts = await fetchBucketCounts(10, 'hard', Date.parse('2026-05-24T00:00:00Z'));
    eq(calls[0].url.endsWith('/rest/v1/rpc/score_counts'), true, 'hits the score_counts RPC');
    eq(counts.total, 34, 'total parsed');
    eq(counts.recent, 9, 'recent parsed');
  }

  // 5) …and the fail-soft that doubles as the feature gate. An un-migrated
  //    database answers 404 to score_counts; the caller must see null (→ no tab)
  //    rather than an exception or a bogus zero.
  {
    installFetch({ status: 404, body: { message: 'Could not find the function' } });
    eq(await fetchBucketCounts(10, 'hard', Date.now()), null, '404 → null, not a throw');
    installFetch({ throw: true });
    eq(await fetchBucketCounts(10, 'hard', Date.now()), null, 'offline → null');
    installFetch({ status: 200, body: [] });
    eq(await fetchBucketCounts(10, 'hard', Date.now()), null, 'an empty answer → null');
    installFetch({ status: 404, body: { message: 'no function' } });
    eq(await fetchTopScores(10, 'hard', { since: Date.now() }), null, 'a failed windowed read → null');
  }

  if (!failed) console.log('PASS: time-scoped reads send what they should and fail soft');
} finally {
  globalThis.fetch = realFetch;
}

process.exit(failed ? 1 : 0);
