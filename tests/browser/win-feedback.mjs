// Browser test for the relative feedback on the win screen (js/main.js: the
// #win-personal line, the global tab's own-row highlight and the debug export).
//
// SAFETY: every Supabase RPC is intercepted with page.route and answered
// locally, so this test NEVER writes a score to the real leaderboard.
//
// What it verifies:
//   1. A device that played BEFORE the solve history existed (top list full,
//      history absent) still gets a comparison against those past games — the
//      seedSolveHistory backfill. Without it the card claimed "Deine 1.-beste
//      von 2 Partien" while showing ten older entries right below.
//   2. On the global tab BEFORE submitting, nothing is highlighted (the solve
//      genuinely isn't on the board yet) and the status line says so.
//   3. After a successful submit the player's own row IS highlighted, the way
//      the local list marks a fresh entry, and the status line reports the
//      share of entries beaten.
//   4. With Debug mode on, the win card offers a copy button and the copied
//      state carries the scoring + everything the percentile came from.
//   5. A long list (the cap is 50 per bucket) stays inside its scroll box, the
//      own row is scrolled into view rather than marked off-screen, and the win
//      card never grows over the top bar. Runs at 375x667 — the short-phone case,
//      where the card used to cover the header even with a ten-row list.
//
// Prereqs: static server on BASE_URL (default http://localhost:8000) and the
// environment's Playwright/Chromium (see board-helpers.mjs). Run with:
//
//   python3 -m http.server 8000 &
//   node tests/browser/win-feedback.mjs

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
// Short phone on purpose: the win card is anchored at the bottom and its fixed
// parts alone are ~390px, so this is the viewport where the height cap matters.
// Pinned to German: this test asserts on visible copy ("deiner N Partien"), so
// the UI language must not follow whatever host the test runs on.
const page = await browser.newPage({ viewport: { width: 375, height: 667 }, locale: 'de-DE' });

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

// The "old device" state: a full local list (50 = MAX_LOCAL_ENTRIES) and no solve
// history at all (that key didn't exist yet), plus Debug mode on for step 4.
//
// Half the seeded times are much faster than a hint-driven solve and half much
// slower, so the fresh result lands in the MIDDLE of the list — far below the ~6
// rows the box shows at this viewport, which is exactly the case that needs
// scrollRowIntoView. Holds for any solve between 59 s and 299 s (measured: ~130-150 s).
const MAX_LOCAL = 50;
const PAST = [
  ...Array.from({ length: 25 }, (_, i) => 10 + i * 2), // 10 … 58
  ...Array.from({ length: 25 }, (_, i) => 300 + i * 2), // 300 … 348
];
await page.addInitScript(
  ({ past }) => {
    localStorage.setItem(
      'queens-clone-settings',
      JSON.stringify({
        size: 5,
        difficulty: 'easy',
        quickMode: true,
        introAnimation: false,
        debug: true,
        nickname: 'IlianP',
      })
    );
    localStorage.setItem(
      'queens-clone-highscores',
      JSON.stringify({
        '5-easy': past.map((s) => ({
          name: 'IlianP',
          seconds: s,
          hints: 0,
          mistakes: 0,
          score: s,
          date: '2026-01-01T00:00:00.000Z',
        })),
      })
    );
    localStorage.removeItem('queens-clone-solves');
  },
  { past: PAST }
);

// --- Fake the online leaderboard so the real DB is never touched. ---
// The fetched top list contains OTHER players plus (after the submit) our own
// entry, so the highlight has to pick the right row rather than a fixed index.
let submitted = null;
const otherRows = [
  { name: 'IlianP', seconds: 14, hints: 0, mistakes: 0, score: 14 },
  { name: 'IlianP', seconds: 14, hints: 0, mistakes: 0, score: 14 },
  { name: 'Anonym', seconds: 22, hints: 0, mistakes: 0, score: 22 },
  { name: 'Gast', seconds: 39, hints: 0, mistakes: 0, score: 39 },
];
await page.route('**/rest/v1/rpc/submit_score', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  submitted = {
    name: body.p_name,
    seconds: body.p_seconds,
    hints: body.p_hints,
    mistakes: body.p_mistakes,
    score: body.p_seconds + 30 * body.p_hints + 15 * body.p_mistakes,
  };
  // rank 3 of 40 → percentile shown (40 ≥ MIN_GLOBAL_FOR_PERCENTILE)
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ rank: 3, total: 40 }]),
  });
});
// Flipped on for step 3b: the list then also holds an entry with EXACTLY our
// values, submitted earlier — the tie that used to mis-place the highlight.
let twinBefore = false;
await page.route('**/rest/v1/rpc/top_scores', async (route) => {
  const rows = otherRows.slice();
  if (submitted) {
    // Ordered the way top_scores does it: equal values, oldest first, so ours
    // is the LAST of the tied run.
    const mine = { ...submitted, created_at: new Date().toISOString() };
    const twin = { ...submitted, created_at: new Date(Date.now() - 2 * 86400000).toISOString() };
    rows.splice(2, 0, ...(twinBefore ? [twin, mine] : [mine])); // lands third, best-first order
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
});

async function solveViaHints() {
  for (let i = 0; i < 400; i++) {
    if (await page.evaluate(() => !document.getElementById('win-overlay').hidden)) return true;
    await page.click('#hint');
    // Check the CARD, not just the apply button: #hint-apply keeps its own
    // `hidden` state from the previous hint, so a card that failed to open reads
    // as "can apply" and the click then waits out its full timeout. A JS error
    // during onWin looks exactly like this, so surface those instead of hanging.
    const open = await page.evaluate(() => !document.getElementById('hint-card').hidden);
    if (!open) throw new Error(`hint card did not open${errors.length ? ' — page errors: ' + errors.join(' | ') : ''}`);
    if (await page.evaluate(() => document.getElementById('hint-apply').hidden)) {
      await page.click('#hint-close');
      break;
    }
    await page.click('#hint-apply');
    await page.waitForTimeout(15);
  }
  return page.evaluate(() => !document.getElementById('win-overlay').hidden);
}

// Rows of the visible score list, with which one carries the "me" highlight.
const listState = () =>
  page.evaluate(() => ({
    rows: [...document.querySelectorAll('#win-scores .score-row')].map((r) => ({
      name: r.querySelector('.score-name').textContent,
      val: r.querySelector('.score-val').textContent,
      me: r.classList.contains('me'),
    })),
    status: document.getElementById('win-submit-status').textContent,
  }));

try {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
  await page.goto(BASE_URL + '/index.html');
  await page.waitForSelector('.cell', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const c = document.querySelector('.cell');
      return c && c.dataset.state !== undefined;
    },
    { timeout: 15000 }
  );

  // The backfill runs at boot, before any game is finished.
  const seeded = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('queens-clone-solves') || '{}')
  );
  // Entries are [score, timestamp] pairs; the timestamp is the one the top-list
  // entry carried, which is what lets a seeded device answer "the last 30 days".
  check(
    'boot seeds the solve history from the existing top list',
    JSON.stringify(seeded['5-easy'].map((e) => (Array.isArray(e) ? e[0] : e))) ===
      JSON.stringify(PAST)
  );
  check(
    'the seeded solves keep the top list\'s date',
    seeded['5-easy'].every(
      (e) => Array.isArray(e) && e[1] === Date.parse('2026-01-01T00:00:00.000Z')
    )
  );

  if (!(await solveViaHints())) throw new Error('could not reach a win via hints');

  // --- 1. the personal line compares against the seeded past, not nothing ---
  const personal = await page.textContent('#win-personal');
  console.log('    personal line:', JSON.stringify(personal));
  check('personal feedback is shown', !!personal.trim());
  check(
    'it counts the seeded past games, not an empty history',
    new RegExp(`deiner ${MAX_LOCAL} Partien`).test(personal) &&
      new RegExp(`von ${MAX_LOCAL + 1}`).test(personal)
  );
  check('it does not claim this is the first game', !/erste Partie/.test(personal));
  check('it names the bucket', /5×5 · Leicht/.test(personal));

  // --- 1b. a long local list scrolls, and the card stays clear of the top bar ---
  {
    // The scroll-into-view is deferred a frame (the list is built before the card
    // is revealed), so wait for it rather than racing it.
    await page.waitForFunction(
      () => {
        const me = document.querySelector('#win-scores .score-row.me');
        return !me || document.getElementById('win-scores').scrollTop > 0;
      },
      { timeout: 5000 }
    );
    const layout = await page.evaluate(() => {
      const list = document.getElementById('win-scores');
      const card = document.getElementById('win-overlay').getBoundingClientRect();
      const header = document.querySelector('header') || document.querySelector('h1');
      const hb = header.getBoundingClientRect();
      const rows = [...list.querySelectorAll('.score-row')];
      const me = list.querySelector('.score-row.me');
      const box = list.getBoundingClientRect();
      const r = me && me.getBoundingClientRect();
      const rowH = rows[0] ? rows[0].getBoundingClientRect().height : 1;
      return {
        rows: rows.length,
        scrolls: list.scrollHeight > list.clientHeight + 1,
        visibleRows: Math.round(box.height / (rowH || 1)),
        cardTop: Math.round(card.top),
        headerBottom: Math.round(hb.bottom),
        meVisible: !!r && r.top >= box.top - 1 && r.bottom <= box.bottom + 1,
        meIndex: me ? rows.indexOf(me) : -1,
        hasMe: !!me,
      };
    });
    console.log('    layout:', JSON.stringify(layout));
    check(`local list is capped at ${MAX_LOCAL} rows`, layout.rows === MAX_LOCAL);
    check('the long list scrolls instead of stretching the card', layout.scrolls);
    check('only a handful of rows are visible at once', layout.visibleRows <= 10);
    check('the win card does not cover the top bar', layout.cardTop >= layout.headerBottom);
    check('the own row is marked', layout.hasMe);
    // It sits mid-list, i.e. below what the box shows unscrolled — without
    // scrollRowIntoView the green marker would be outside the visible area.
    check('the own row would be off-screen unscrolled', layout.meIndex > layout.visibleRows);
    check('the own row is scrolled into the visible box', layout.meVisible);
  }

  // --- 1c. entry age: dated rows show one, undated rows show none ---------
  {
    const ages = await page.evaluate(() =>
      [...document.querySelectorAll('#win-scores .score-row')].map((r) => {
        const a = r.querySelector('.score-age');
        return a ? a.textContent : null;
      })
    );
    // The 50 seeded entries are from 2026-01-01, so months old; the previewed
    // fresh row is dated too (it was solved seconds ago), because a single row
    // without an age in an otherwise dated list reads as a missing value.
    check('every row shows how old it is', ages.every((a) => a !== null));
    check('… as a relative age', ages.every((a) => /vor|gestern|Jahr|jetzt/.test(a)));
    check('the fresh row is the one that just happened', ages.some((a) => /jetzt|Sek/.test(a)));
  }

  // --- 2. global tab before submitting: nothing highlighted, and it says why ---
  await page.click('#win-tab-global');
  await page.waitForFunction(
    () => document.querySelectorAll('#win-scores .score-row').length > 0,
    { timeout: 15000 }
  );
  let s = await listState();
  check('global list loaded', s.rows.length === otherRows.length);
  // The mock answers like an un-migrated server: no created_at anywhere. The
  // list must render exactly as before rather than showing "vor 56 Jahren".
  check(
    'rows without created_at show no age (un-migrated server)',
    await page.evaluate(() => !document.querySelector('#win-scores .score-age'))
  );
  check('nothing is highlighted before submitting', s.rows.every((r) => !r.me));
  check('the status line explains the absence', /Noch nicht eingetragen/.test(s.status));

  // --- 3. after submitting: own row highlighted + percentile in the status ---
  await page.click('#win-submit');
  await page.waitForFunction(
    () => /Global eingetragen/.test(document.getElementById('win-submit-status').textContent),
    { timeout: 15000 }
  );
  await page.waitForFunction(
    () => document.querySelectorAll('#win-scores .score-row').length === 5,
    { timeout: 15000 }
  );
  s = await listState();
  const meIdx = s.rows.findIndex((r) => r.me);
  console.log('    global rows:', JSON.stringify(s.rows));
  check('exactly one row is highlighted', s.rows.filter((r) => r.me).length === 1);
  check('the highlighted row is the freshly submitted one', meIdx === 2);
  check(
    'status reports placement and the share beaten',
    // \s, not a literal space: German renders "88 %" with a NON-BREAKING one
    // (Intl/DIN 5008), so a plain space never matches.
    /Platz 3 von 40/.test(s.status) && /besser als \d+\s%/.test(s.status)
  );

  // --- 3b. a tie must not move the highlight to the other row --------------
  // Someone else (or an earlier run) is on the board with exactly our values.
  // top_scores puts the older of them first, so ours is the second one — while
  // submit_score's rank pointed at the first. Marking by that rank outlined the
  // row ABOVE the entry that had just been submitted, which is the reported bug.
  {
    twinBefore = true;
    await page.click('#win-tab-local');
    await page.waitForTimeout(100);
    await page.click('#win-tab-global');
    await page.waitForFunction(
      () => document.querySelectorAll('#win-scores .score-row').length === 6,
      { timeout: 15000 }
    );
    const tie = await page.evaluate(() =>
      [...document.querySelectorAll('#win-scores .score-row')].map((r) => ({
        val: r.querySelector('.score-val').textContent,
        age: r.querySelector('.score-age')?.textContent ?? null,
        me: r.classList.contains('me'),
      }))
    );
    console.log('    tie rows:', JSON.stringify(tie));
    const marked = tie.filter((r) => r.me);
    check('exactly one row is highlighted despite the tie', marked.length === 1);
    check('the two tied rows really are identical', tie[2].val === tie[3].val);
    check('the highlight is on the NEWER of the two, not the row above it', tie[3].me && !tie[2].me);
    check('and their ages tell them apart', tie[2].age !== tie[3].age && /jetzt|Sek/.test(tie[3].age));
    twinBefore = false;
    await page.click('#win-tab-local');
    await page.waitForTimeout(100);
    await page.click('#win-tab-global');
    await page.waitForFunction(
      () => document.querySelectorAll('#win-scores .score-row').length === 5,
      { timeout: 15000 }
    );
  }

  // Switching away and back keeps the highlight (it must not depend on the
  // submit having just happened).
  await page.click('#win-tab-local');
  await page.waitForTimeout(100);
  await page.click('#win-tab-global');
  await page.waitForFunction(
    () => [...document.querySelectorAll('#win-scores .score-row')].some((r) => r.classList.contains('me')),
    { timeout: 15000 }
  );
  check('highlight survives a tab round-trip', (await listState()).rows.some((r) => r.me));

  // --- 4. debug export from the win card ---
  check('win card offers the debug copy in Debug mode', await page.isVisible('#win-debug-copy'));
  await page.click('#win-debug-copy');
  await page.waitForTimeout(200);
  const dbg = await page.evaluate(() => navigator.clipboard.readText());
  check('debug state has a result block', /"result": \{/.test(dbg));
  check('… with the score components', /"scoreFormula"/.test(dbg) && /"score"/.test(dbg));
  check('… with the personal comparison inputs', new RegExp(`"previousSolves": ${MAX_LOCAL}`).test(dbg));
  check('… with the raw history it was computed from', new RegExp(`"historyCount": ${MAX_LOCAL + 1}`).test(dbg));
  check('… and the global result', /"rank": 3/.test(dbg) && /"total": 40/.test(dbg));

  // --- 6. the rolling-window line on a second solve -------------------------
  // The history is rewritten between the two games: a batch of old solves plus a
  // few from the last few days, which is exactly the shape that makes the third
  // line meaningful (a window that holds a field, but not the whole history).
  {
    await page.evaluate(() => {
      const day = 24 * 60 * 60 * 1000;
      const now = Date.now();
      localStorage.setItem(
        'queens-clone-solves',
        JSON.stringify({
          '5-easy': [
            ...[40, 45, 50, 55, 60, 65].map((s, i) => [s, now - (300 - i) * day]), // long past
            ...[200, 210, 220, 230].map((s, i) => [s, now - (6 - i) * day]), // current form
          ],
        })
      );
    });
    await page.click('#win-new-game');
    await page.waitForTimeout(300);
    if (!(await solveViaHints())) throw new Error('could not reach a second win');
    const win = await page.evaluate(() => ({
      all: document.querySelector('#win-personal .win-personal-main')?.textContent || '',
      window: document.querySelector('#win-personal .win-personal-window')?.textContent || '',
    }));
    console.log('    window line:', JSON.stringify(win.window));
    check('the win card adds a line for the rolling window', !!win.window);
    check('… naming the window length', /30 Tage/.test(win.window));
    check(
      '… and comparing against the recent solves only',
      /besser als|Platz|beste Zeit/.test(win.window)
    );
    check('the all-time line is still there next to it', !!win.all);
    // A third line is still a line: the card's height cap has to absorb it on
    // the short phone this test runs on.
    const layout = await page.evaluate(() => {
      const card = document.getElementById('win-overlay').getBoundingClientRect();
      const header = (document.querySelector('header') || document.querySelector('h1')).getBoundingClientRect();
      return { cardTop: Math.round(card.top), headerBottom: Math.round(header.bottom) };
    });
    check('the extra line does not push the card over the top bar', layout.cardTop >= layout.headerBottom);
  }

  if (errors.length) check(`no console errors (got ${JSON.stringify(errors)})`, false);
} catch (e) {
  check(`test threw: ${e && e.message}`, false);
} finally {
  await browser.close();
}

console.log(failed ? '\nwin-feedback: FAILED' : '\nwin-feedback: all passed');
process.exit(failed ? 1 : 0);
