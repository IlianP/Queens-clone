// Browser test for the global-submit RETRY + DUPLICATE-GUARD behaviour on the
// win screen (js/main.js onWinSubmit).
//
// SAFETY: every Supabase RPC is intercepted with page.route and answered
// locally, so this test NEVER writes a score to the real leaderboard. The
// submit endpoint is failed on demand to drive the retry path and then flipped
// to success to drive the manual retry — all without touching the network.
//
// What it verifies:
//   1. A transient submit failure is auto-retried a bounded number of times
//      (4 attempts total) instead of giving up after one.
//   2. When the auto-retries are exhausted the button becomes a manual retry
//      ("Erneut versuchen") rather than a dead end.
//   3. A manual retry that succeeds locks the result in ("Global eingetragen").
//   4. Once submitted globally, the same solve can NEVER be submitted again —
//      even if the button is forced back to enabled, no further request fires.
//
// Prereqs: static server on BASE_URL (default http://localhost:8000) and the
// environment's Playwright/Chromium (see board-helpers.mjs). Run with:
//
//   python3 -m http.server 8000 &
//   node tests/browser/leaderboard-retry.mjs
//
// It exercises the real backoff schedule (~5.6s to exhaust), so it is slow by
// design. Exits non-zero on failure.

const PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.js';
const CHROMIUM = '/opt/pw-browsers/chromium';
const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL: ' + msg);
};

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch({ executablePath: CHROMIUM });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const errors = [];
// The aborted submit routes below are *deliberate* network failures; the
// browser logs a generic "Failed to load resource" for each, which is expected
// noise here (the app swallows them and falls back). Keep only real errors.
const isSimulatedNetworkNoise = (t) => /Failed to load resource|net::ERR_FAILED/i.test(t);
page.on('console', (m) => {
  if (m.type() === 'error' && !isSimulatedNetworkNoise(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

// Small, fast, deterministic-ish board and no intro animation, so solving via
// hints is quick. Seeded before any script runs.
await page.addInitScript(() => {
  localStorage.setItem(
    'queens-clone-settings',
    JSON.stringify({ size: 5, difficulty: 'easy', quickMode: true, introAnimation: false })
  );
});

// --- Fake the online leaderboard so the real DB is never touched. ---
let submitCalls = 0;
let succeed = false; // flipped to true to let a submit through
await page.route('**/rest/v1/rpc/submit_score', async (route) => {
  submitCalls++;
  if (succeed) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ rank: 1, total: 1 }]),
    });
  } else {
    await route.abort(); // network-style failure -> transient, should retry
  }
});
await page.route('**/rest/v1/rpc/top_scores', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ name: 'Tester', seconds: 42, hints: 0, mistakes: 0, score: 42 }]),
  });
});

const submitStatus = () =>
  page.evaluate(() => {
    const s = document.getElementById('win-submit-status');
    const b = document.getElementById('win-submit');
    return { text: s.textContent, disabled: b.disabled, label: b.textContent };
  });

// Solve the current puzzle purely by applying hints, exactly like the pure-Node
// hint-solve smoke test — it drives the board to a genuine win, firing onWin().
async function solveViaHints() {
  for (let i = 0; i < 400; i++) {
    if (await page.evaluate(() => !document.getElementById('win-overlay').hidden)) return true;
    await page.click('#hint');
    const canApply = await page.evaluate(() => !document.getElementById('hint-apply').hidden);
    if (!canApply) {
      await page.click('#hint-close');
      break;
    }
    await page.click('#hint-apply');
    await page.waitForTimeout(15);
  }
  return page.evaluate(() => !document.getElementById('win-overlay').hidden);
}

try {
  await page.goto(BASE_URL + '/index.html');
  await page.waitForSelector('.cell', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const c = document.querySelector('.cell');
      return c && c.dataset.state !== undefined;
    },
    { timeout: 15000 }
  );

  if (!(await solveViaHints())) {
    fail('could not reach a win via hints');
    throw new Error('no win');
  }

  // The win card is up. Enter a name and submit while the server is "down".
  await page.fill('#win-nickname', 'Tester');
  await page.click('#win-submit');

  // Auto-retries run and exhaust; the button turns into a manual retry.
  await page.waitForFunction(
    () => {
      const b = document.getElementById('win-submit');
      return !b.disabled && /Erneut versuchen/i.test(b.textContent);
    },
    { timeout: 20000 }
  );
  let s = await submitStatus();
  if (s.disabled) fail(`after exhausted retries the button should be enabled, got ${JSON.stringify(s)}`);
  if (!/Erneut versuchen/i.test(s.label)) fail(`button should offer a manual retry, got "${s.label}"`);
  if (!/nicht erreichbar/i.test(s.text)) fail(`status should report the failure, got "${s.text}"`);
  if (submitCalls !== 4) fail(`expected 4 bounded auto-attempts, got ${submitCalls}`);

  // Now let the network through and use the manual retry.
  succeed = true;
  await page.click('#win-submit');
  await page.waitForFunction(
    () => /Global eingetragen/i.test(document.getElementById('win-submit-status').textContent),
    { timeout: 15000 }
  );
  s = await submitStatus();
  if (!s.disabled) fail(`after a successful submit the button must be disabled, got ${JSON.stringify(s)}`);
  const callsAfterSuccess = submitCalls; // one more than before -> 5
  if (callsAfterSuccess !== 5) fail(`manual retry should be exactly one more attempt, got ${submitCalls}`);

  // DUPLICATE GUARD: even if the button is forced back to enabled, the same
  // solve must not be submitted a second time — no further request may fire.
  await page.evaluate(() => (document.getElementById('win-submit').disabled = false));
  await page.click('#win-submit', { force: true });
  await page.waitForTimeout(300);
  if (submitCalls !== callsAfterSuccess)
    fail(`a re-submit of the same solve must not hit the server (dup guard), calls went ${callsAfterSuccess} -> ${submitCalls}`);
  s = await submitStatus();
  if (!/Global eingetragen/i.test(s.text)) fail(`status should still show the success, got "${s.text}"`);

  if (errors.length) fail('console/page errors: ' + errors.join(' | '));
  if (!failed) console.log('PASS: submit auto-retries, offers manual retry, and never double-submits a solve');
} finally {
  await browser.close();
}

process.exit(failed ? 1 : 0);
