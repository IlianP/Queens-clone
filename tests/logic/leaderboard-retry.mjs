// Pure-Node test for the online submit RETRY logic in js/leaderboard.js.
//
// This never touches the real Supabase project: it replaces the global `fetch`
// with a scripted mock, so no test scores are ever written to the live
// leaderboard. It asserts that submitScore():
//   * retries a transient failure (network throw / 5xx / 429) with backoff and
//     eventually succeeds,
//   * does NOT retry a permanent failure (a 4xx rejection), and
//   * gives up after a bounded number of attempts, resolving null and reporting
//     progress through the onRetry callback.
//
// Run: node tests/logic/leaderboard-retry.mjs   (takes a few seconds — the real
// backoff waits are exercised on purpose so the schedule itself is covered.)

import { submitScore } from '../../js/leaderboard.js';

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL: ' + msg);
};

const SUBMIT_URL = '/rest/v1/rpc/submit_score';
const ENTRY = { name: 'Tester', size: 7, difficulty: 'medium', seconds: 42, hints: 0, mistakes: 0 };
const okBody = [{ rank: 3, total: 10 }];

// Install a fetch mock that plays back `steps` in order. Each step is either
// { throw: true } (network error), or { status, body }. Records every URL hit.
function installFetch(steps) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const i = calls.length;
    calls.push(String(url));
    const step = steps[Math.min(i, steps.length - 1)];
    if (step.throw) throw new Error('network down');
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => step.body,
    };
  };
  return calls;
}

const realFetch = globalThis.fetch;

try {
  // 1) Transient (throw) twice, then success -> resolves the rank, 3 calls total.
  {
    const calls = installFetch([{ throw: true }, { throw: true }, { status: 200, body: okBody }]);
    const retries = [];
    const res = await submitScore(ENTRY, { onRetry: (a, t) => retries.push([a, t]) });
    if (!res || res.rank !== 3 || res.total !== 10) fail(`transient-then-ok: bad result ${JSON.stringify(res)}`);
    if (calls.length !== 3) fail(`transient-then-ok: expected 3 attempts, got ${calls.length}`);
    if (!calls.every((u) => u.endsWith(SUBMIT_URL))) fail(`transient-then-ok: wrong URL ${calls[0]}`);
    // Two failures before success -> two retry notifications, numbered 2 then 3.
    if (retries.length !== 2 || retries[0][0] !== 2 || retries[1][0] !== 3)
      fail(`transient-then-ok: bad onRetry sequence ${JSON.stringify(retries)}`);
  }

  // 2) A 5xx is transient too: 503 once, then success -> 2 calls.
  {
    const calls = installFetch([{ status: 503, body: null }, { status: 200, body: okBody }]);
    const res = await submitScore(ENTRY);
    if (!res || res.rank !== 3) fail(`5xx-then-ok: bad result ${JSON.stringify(res)}`);
    if (calls.length !== 2) fail(`5xx-then-ok: expected 2 attempts, got ${calls.length}`);
  }

  // 3) A 4xx is PERMANENT: no retry, resolves null after a single attempt.
  {
    const calls = installFetch([{ status: 400, body: { message: 'implausible time' } }]);
    const retries = [];
    const res = await submitScore(ENTRY, { onRetry: () => retries.push(1) });
    if (res !== null) fail(`4xx: expected null, got ${JSON.stringify(res)}`);
    if (calls.length !== 1) fail(`4xx: expected exactly 1 attempt (no retry), got ${calls.length}`);
    if (retries.length !== 0) fail(`4xx: onRetry should not fire, fired ${retries.length}x`);
  }

  // 4) Persistent transient failure: gives up after a bounded number of tries
  //    (first attempt + 3 retries = 4) and resolves null.
  {
    const calls = installFetch([{ throw: true }]);
    const retries = [];
    const res = await submitScore(ENTRY, { onRetry: (a, t) => retries.push([a, t]) });
    if (res !== null) fail(`exhaust: expected null, got ${JSON.stringify(res)}`);
    if (calls.length !== 4) fail(`exhaust: expected 4 attempts, got ${calls.length}`);
    if (retries.length !== 3) fail(`exhaust: expected 3 retry notices, got ${retries.length}`);
    if (retries.some(([, t]) => t !== 4)) fail(`exhaust: total attempts should be 4, got ${JSON.stringify(retries)}`);
  }

  if (!failed) console.log('PASS: submit retry backs off on transient failures, not on permanent ones');
} finally {
  globalThis.fetch = realFetch;
}

process.exit(failed ? 1 : 0);
