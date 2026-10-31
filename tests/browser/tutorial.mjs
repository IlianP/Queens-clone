// The guided tutorial on its fixed 5x5 board (see "Tutorial" in js/main.js):
// offered on first visit, each guided step lets through only the taps it asks
// for, the steps advance from board state, nothing is scored, the coach card
// never covers the board, and leaving starts a normal game.
//
// The offer is skipped for automated browsers so every other test boots into a
// game; `?tutorial` forces it here.
import { stubStats, tapCell, cellState, cellIndex } from './board-helpers.mjs';

const PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.js';
const pw = (await import(PLAYWRIGHT)).default;
const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let failed = 0;
const check = (ok, msg) => {
  if (!ok) {
    failed++;
    console.error('FAIL', msg);
  }
};

async function run(viewport) {
  const page = await browser.newPage({ viewport, locale: 'de-DE' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await stubStats(page);
  await page.goto('http://localhost:8000/index.html?tutorial');
  const tag = `${viewport.width}x${viewport.height}`;
  const visible = (id) => page.evaluate((i) => !document.getElementById(i).hidden, id);
  const title = () => page.textContent('#tutorial-title');
  const idx = (r, c) => cellIndex(5, r, c);

  await page.waitForSelector('#tutorial-welcome:not([hidden])');
  check((await page.$$('.cell')).length === 0, `${tag}: no board is generated behind the offer`);
  await page.click('#tutorial-start');
  await page.waitForSelector('#tutorial-card:not([hidden])');
  check((await page.$$('.cell')).length === 25, `${tag}: tutorial board is 5x5`);
  check(/Schritt 1 von 5/.test(await page.textContent('#tutorial-progress')), `${tag}: step counter`);

  // The card must sit clear of the board, or a guided tap would land on it.
  const geo = await page.evaluate(() => {
    const b = document.getElementById('board').getBoundingClientRect();
    const c = document.getElementById('tutorial-card').getBoundingClientRect();
    return { boardBottom: b.bottom, cardTop: c.top, cardBottom: c.bottom, vh: innerHeight };
  });
  check(geo.cardTop >= geo.boardBottom - 1, `${tag}: card overlaps board (${JSON.stringify(geo)})`);
  check(geo.cardBottom <= geo.vh, `${tag}: card off-screen`);

  // Step 1 (goal): the board is locked until "Weiter".
  await tapCell(page, idx(0, 0));
  check((await cellState(page, idx(0, 0))) === 'empty', `${tag}: tap during goal card ignored`);
  check((await page.textContent('#tutorial-nudge')).length > 0, `${tag}: goal nudge shown`);
  await page.click('#tutorial-next');

  // Step 2: only a1, twice.
  check((await title()) === 'Deine erste Dame', `${tag}: step 2 title`);
  await tapCell(page, idx(2, 2));
  check((await cellState(page, idx(2, 2))) === 'empty', `${tag}: off-target tap blocked`);
  await tapCell(page, idx(0, 0));
  check((await cellState(page, idx(0, 0))) === 'dot', `${tag}: first tap = dot`);
  check(/noch einmal/.test(await page.textContent('#tutorial-text')), `${tag}: dot wording`);
  await tapCell(page, idx(0, 0));
  check((await cellState(page, idx(0, 0))) === 'queen', `${tag}: second tap = queen`);

  // Step 3: mark the three blocked cells of the blue region; a dot can't be re-tapped into a queen.
  check((await title()) === 'Gesperrte Felder', `${tag}: step 3 title`);
  const hatched = await page.$$eval('.cell.tut-blocked', (cs) => cs.length);
  check(hatched === 9, `${tag}: 9 blocked cells hatched (got ${hatched})`);
  await tapCell(page, idx(0, 1));
  await tapCell(page, idx(0, 1));
  check((await cellState(page, idx(0, 1))) === 'dot', `${tag}: dot not upgraded during step 3`);
  await tapCell(page, idx(0, 2));
  check(/2\/3/.test(await page.textContent('#tutorial-text')), `${tag}: progress 2/3`);
  await tapCell(page, idx(1, 1));

  // Step 4: c2, twice.
  check((await title()) === 'Nur noch ein Feld frei', `${tag}: step 4 title`);
  await tapCell(page, idx(1, 2));
  await tapCell(page, idx(1, 2));

  // Step 5: free play; the card gets out of the way.
  check((await title()) === 'Jetzt du!', `${tag}: step 5 title`);
  check(await page.$eval('#hint', (b) => b.classList.contains('tut-pulse')), `${tag}: hint button pulses`);
  await page.click('#tutorial-next');
  check(!(await visible('tutorial-card')), `${tag}: card hidden in free play`);
  for (const [r, c] of [[2, 4], [3, 1], [4, 3]]) {
    await tapCell(page, idx(r, c));
    await tapCell(page, idx(r, c));
  }

  // Done: no win card, no score, no history.
  await page.waitForSelector('#tutorial-card:not([hidden])');
  check((await title()) === '🎉 Geschafft!', `${tag}: done title`);
  check(!(await visible('win-overlay')), `${tag}: no win card`);
  const stored = await page.evaluate(() => [localStorage.getItem('queens-clone-solves'), localStorage.getItem('queens-clone-scores')]);
  check(!stored[0] && !stored[1], `${tag}: nothing recorded (${stored})`);
  check(await page.evaluate(() => getComputedStyle(document.getElementById('status')).visibility === 'hidden'), `${tag}: timer hidden`);
  check((await page.evaluate(() => localStorage.getItem('queens-clone-tutorial'))) === 'seen', `${tag}: seen flag`);

  // Leaving starts a real game at the configured size.
  await page.click('#tutorial-next');
  await page.waitForFunction(() => document.querySelectorAll('.cell').length === 64 && document.querySelector('.cell').dataset.state !== undefined, null, { timeout: 15000 });
  check(!(await page.evaluate(() => document.documentElement.classList.contains('tutorial-on'))), `${tag}: tutorial state cleared`);
  check(!(await visible('tutorial-card')), `${tag}: card gone after exit`);

  // Re-entry from the settings.
  await page.click('#open-settings');
  await page.click('#settings-tutorial');
  await page.waitForSelector('#tutorial-card:not([hidden])');
  check((await page.$$('.cell')).length === 25, `${tag}: settings button restarts tutorial`);
  await page.click('#tutorial-exit');
  await page.waitForFunction(() => document.querySelectorAll('.cell').length === 64, null, { timeout: 15000 });

  check(errors.length === 0, `${tag}: page errors ${errors.join(' | ')}`);
  await page.close();
}

await run({ width: 390, height: 844 });
await run({ width: 375, height: 667 });
await run({ width: 320, height: 568 });
await browser.close();
if (failed) process.exit(1);
console.log('tutorial: all passed');
