// Browser test for the ADAPTIVE time-scoped tab in the Bestenliste modal
// (js/main.js: refreshPeriodTab / periodOffered / renderLb).
//
// SAFETY: every Supabase RPC is intercepted with page.route and answered
// locally — the live leaderboard is never read from or written to.
//
// The feature's whole point is that the tab appears only where it means
// something, so that is what this asserts, bucket by bucket:
//   1. a bucket with a real field inside the window → the tab is offered, and
//      clicking it fetches with p_since and shows that (shorter) list;
//   2. a bucket with almost nothing inside the window → no tab;
//   3. a bucket whose entries are ALL inside the window → no tab either (it
//      would be a copy of the global list under a different name);
//   4. a server without score_counts (docs/leaderboard-setup.sql not re-run)
//      → no tab, and the modal behaves exactly as it did before;
//   5. switching to a bucket that doesn't offer it while it is open must not
//      strand the view on a tab that is gone.
//
// Prereqs: static server on BASE_URL (default http://localhost:8000) and the
// environment's Playwright/Chromium (see board-helpers.mjs). Run with:
//
//   python3 -m http.server 8000 &
//   node tests/browser/leaderboard-period.mjs

const PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.js';
const CHROMIUM = '/opt/pw-browsers/chromium';
const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

let failed = false;
const check = (msg, ok) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failed = true;
};

const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch({ executablePath: CHROMIUM });
// German: this test reads the tab label, which carries the window length.
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });

const errors = [];
// Step 4 deliberately answers score_counts with 404 (the un-migrated server), and
// Chromium logs every failed request to the console. That one is the fixture, not
// a defect — everything else still has to stay silent.
const EXPECTED_404 = /Failed to load resource.*404/;
page.on('console', (m) => m.type() === 'error' && !EXPECTED_404.test(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.addInitScript(() => {
  localStorage.setItem(
    'queens-clone-settings',
    JSON.stringify({ size: 9, difficulty: 'hard', quickMode: true, introAnimation: false })
  );
});

// How each bucket answers score_counts. The size is the only thing that varies
// here — difficulty stays 'hard' throughout.
const COUNTS = {
  9: { total: 34, recent: 9 }, // a field inside the window → offer the tab
  8: { total: 30, recent: 2 }, // window nearly empty → no tab
  7: { total: 6, recent: 6 }, // everything is recent → nothing to add
  6: null, // 404: score_counts doesn't exist on this server
};

let countCalls = 0;
await page.route('**/rest/v1/rpc/score_counts', async (route) => {
  countCalls++;
  const body = JSON.parse(route.request().postData() || '{}');
  const counts = COUNTS[body.p_size];
  if (!counts) {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Could not find the function public.score_counts' }),
    });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([counts]) });
});

const row = (name, score, daysAgo) => ({
  name,
  seconds: score,
  hints: 0,
  mistakes: 0,
  score,
  created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
});
const ALL_ROWS = [row('Alt', 40, 300), row('Auch alt', 55, 200), row('Neu', 61, 3), row('Frisch', 70, 1)];
const PERIOD_ROWS = [row('Neu', 61, 3), row('Frisch', 70, 1)];

const topCalls = [];
await page.route('**/rest/v1/rpc/top_scores', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  topCalls.push(body);
  const rows = body.p_since ? PERIOD_ROWS : ALL_ROWS;
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
});

const periodVisible = () => page.isVisible('#lb-tab-period');
const listNames = () =>
  page.$$eval('#lb-scores .score-row .score-name', (ns) => ns.map((n) => n.textContent));
// The tab is revealed asynchronously (score_counts has to answer first), so
// wait for the expected state instead of racing it.
const waitForPeriodTab = (want) =>
  page
    .waitForFunction(
      (w) => !document.getElementById('lb-tab-period').hidden === w,
      want,
      { timeout: 8000 }
    )
    .then(() => true)
    .catch(() => false);

async function selectSize(n) {
  await page.locator('#lb-size-range').fill(String(n));
  await page.waitForTimeout(50);
}

try {
  await page.goto(BASE_URL + '/index.html');
  await page.waitForSelector('.cell', { timeout: 15000 });
  await page.click('#open-leaderboard');
  await page.waitForSelector('#leaderboard-overlay:not([hidden])', { timeout: 5000 });

  // --- 1. a bucket that earns the tab ---------------------------------------
  check('the period tab appears for a bucket with a field in the window', await waitForPeriodTab(true));
  check('score_counts was asked', countCalls > 0);
  check('the tab names the window length', /90/.test(await page.textContent('#lb-tab-period')));
  check('it starts on the local tab', await page.$eval('#lb-tab-local', (b) => b.getAttribute('aria-selected') === 'true'));

  // The all-time global list first, for comparison.
  await page.click('#lb-tab-global');
  await page.waitForFunction(() => document.querySelectorAll('#lb-scores .score-row').length === 4, { timeout: 8000 });
  check('the global tab shows every entry', (await listNames()).length === ALL_ROWS.length);
  check(
    'and no p_since was sent for it',
    topCalls.length > 0 && topCalls[topCalls.length - 1].p_since === undefined
  );
  check(
    'rows carry their age',
    await page.evaluate(() => document.querySelectorAll('#lb-scores .score-age').length === 4)
  );
  check(
    'the last week is marked as fresh',
    await page.evaluate(() => document.querySelectorAll('#lb-scores .score-age.fresh').length === 2)
  );

  // --- the windowed list ----------------------------------------------------
  await page.click('#lb-tab-period');
  await page.waitForFunction(() => document.querySelectorAll('#lb-scores .score-row').length === 2, { timeout: 8000 });
  const sent = topCalls[topCalls.length - 1];
  check('the windowed read sends p_since', typeof sent.p_since === 'string');
  check(
    'p_since is about 90 days back',
    Math.abs((Date.now() - Date.parse(sent.p_since)) / 86400000 - 90) < 1
  );
  check('the window shows only its own entries', JSON.stringify(await listNames()) === '["Neu","Frisch"]');

  // --- 2. a bucket with an almost empty window ------------------------------
  await selectSize(8);
  check('no tab where the window holds almost nothing', await waitForPeriodTab(false));
  check(
    'and the view falls back to the global tab',
    await page.$eval('#lb-tab-global', (b) => b.getAttribute('aria-selected') === 'true')
  );

  // --- 3. a bucket where everything is recent -------------------------------
  await selectSize(7);
  check('no tab where the window covers every entry', await waitForPeriodTab(false));

  // --- 4. a server that never got the SQL migration -------------------------
  await selectSize(6);
  check('no tab when score_counts is missing (404)', await waitForPeriodTab(false));
  await page.click('#lb-tab-global');
  await page.waitForFunction(() => document.querySelectorAll('#lb-scores .score-row').length === 4, { timeout: 8000 });
  check('the plain global list still works there', (await listNames()).length === ALL_ROWS.length);

  // --- 5. back to a bucket that offers it, then away while it is open -------
  await selectSize(9);
  check('the tab comes back for the bucket that has a window', await waitForPeriodTab(true));
  await page.click('#lb-tab-period');
  await page.waitForFunction(() => document.querySelectorAll('#lb-scores .score-row').length === 2, { timeout: 8000 });
  await selectSize(8);
  check('leaving the bucket hides the tab again', await waitForPeriodTab(false));
  check(
    'and the open view moves to the global tab instead of going blank',
    await page.$eval('#lb-tab-global', (b) => b.getAttribute('aria-selected') === 'true')
  );

  // --- tab layout at phone width -------------------------------------------
  // Three tabs is one more than this row was designed for, and the widest label
  // carries an emoji — so measure the elements themselves at the narrowest
  // width the app supports, not just at the comfortable one.
  await selectSize(9);
  await waitForPeriodTab(true);
  for (const width of [390, 360, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(60);
    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll('#lb-tabs .score-tab')]
        .filter((b) => !b.hidden)
        .map((b) => ({
          w: Math.round(b.getBoundingClientRect().width),
          h: Math.round(b.getBoundingClientRect().height),
          clipped: b.scrollWidth > b.clientWidth + 1,
        }))
    );
    console.log(`    tabs @${width}:`, JSON.stringify(tabs));
    check(`three tabs are shown @${width}`, tabs.length === 3);
    check(`none of them wraps to a second line @${width}`, tabs.every((t) => t.h < 44));
    check(`none of them is clipped @${width}`, tabs.every((t) => !t.clipped));
  }

  if (errors.length) check(`no console errors (got ${JSON.stringify(errors)})`, false);
} catch (e) {
  check(`test threw: ${e && e.message}`, false);
} finally {
  await browser.close();
}

console.log(failed ? '\nleaderboard-period: FAILED' : '\nleaderboard-period: all passed');
process.exit(failed ? 1 : 0);
