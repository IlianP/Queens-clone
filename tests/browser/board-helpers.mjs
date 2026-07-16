// Reusable Playwright harness for driving the real game in a browser.
//
// This file exists to capture the hard-won, easy-to-forget knowledge about how
// this particular board must be driven — the stuff that costs a fresh session
// an hour of trial and error every time:
//
//   1. Playwright is PROVIDED BY THE ENVIRONMENT here, not a repo dependency
//      (this project ships with no package.json on purpose). It lives at a
//      fixed global path and its module is CommonJS, so it must be imported via
//      the default export, not a named one. Both are handled by launch() below.
//   2. The Chromium binary is preinstalled at /opt/pw-browsers/chromium — pass
//      it as executablePath so Playwright never tries to download one.
//   3. Pointer handling lives on the BOARD element with real pointer capture,
//      so hand-dispatched PointerEvents don't drive it — you must use the real
//      mouse (page.mouse.click). tapCell / placeQueen below do that.
//   4. The tap cycle is empty -> dot -> queen -> empty, BUT a cell that is
//      already auto-marked (quick mode dots a queen's whole row/column) jumps
//      straight to a queen in ONE tap. placeQueen() taps until the cell is
//      actually a queen, so it's correct regardless of quick mode.
//
// Start a static server first (the app is ES modules + a worker, so file://
// won't load): `python3 -m http.server 8000`, then point BASE_URL at it.
//
// These tests are a developer aid, not CI — nothing runs them automatically,
// and the fixed /opt paths mean they only run in this kind of environment.

const PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.js';
const CHROMIUM = '/opt/pw-browsers/chromium';

// Launch a mobile-sized Chromium (this is a touch-first game — always test at
// phone size) and open the game. Returns { browser, page } plus a collected
// `errors` array you should assert stays empty. Caller closes the browser.
export async function openGame(baseUrl = 'http://localhost:8000') {
  const pw = (await import(PLAYWRIGHT)).default;
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(baseUrl + '/index.html');
  await page.waitForSelector('.cell', { timeout: 15000 });
  // Wait until the board is actually rendered (updateBoard has stamped state),
  // not merely present in the DOM during the intro animation.
  await page.waitForFunction(
    () => {
      const c = document.querySelector('.cell');
      return c && c.dataset.state !== undefined;
    },
    { timeout: 15000 }
  );

  return { browser, page, errors };
}

// Board size N (cells form an N x N grid).
export async function boardSize(page) {
  const count = await page.$$eval('.cell', (cs) => cs.length);
  return Math.round(Math.sqrt(count));
}

// The dataset.state of the cell at flat index idx: 'empty' | 'dot' | 'queen'.
export function cellState(page, idx) {
  return page.evaluate((i) => document.querySelectorAll('.cell')[i].dataset.state, idx);
}

export const cellIndex = (N, r, c) => r * N + c;

// One real tap on a cell (down+up via the mouse, so pointer capture engages).
export async function tapCell(page, idx) {
  const box = await page.evaluate((i) => {
    const c = document.querySelectorAll('.cell')[i];
    const r = c.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, idx);
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(40);
}

// Tap a cell until it holds a queen (max 3 taps covers every cycle position,
// auto-marked or not). Returns true once the cell is a queen.
export async function placeQueen(page, idx) {
  for (let i = 0; i < 3; i++) {
    if ((await cellState(page, idx)) === 'queen') return true;
    await tapCell(page, idx);
  }
  return (await cellState(page, idx)) === 'queen';
}

// How many cells currently carry the red conflict marking.
export function conflictCount(page) {
  return page.$$eval('.cell.conflict', (cs) => cs.length);
}
