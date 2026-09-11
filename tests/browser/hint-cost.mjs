// Does the hint surcharge show itself — before the click, at the click, and on
// the win screen?
//
// A hint costs HINT_PENALTY seconds, and for a long time nothing said so until
// the win screen. Three surfaces now carry it, and the one that can silently go
// wrong is the middle one: hintsUsed only bumps for a NEW deduction (seenHints,
// issue #37), so re-opening the same hint is free. An animation tied to the
// click rather than to that branch would charge the player visually for
// something the score doesn't charge — a lie the win screen then contradicts.
// That is the case worth a browser test, because it is invisible in the diff.
//
// Also guards the layout: the button's label grew by "(+30s)", and .actions is
// a wrapping row in portrait but a fixed-width column in landscape, where
// .btn is white-space: nowrap. A label that outgrows that column doesn't
// report itself — it just paints over its neighbour.
//
// Start a static server first: python3 -m http.server 8000
// Run: node tests/browser/hint-cost.mjs

import { openGame } from './board-helpers.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
let failed = false;
function ok(cond, msg) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed = true;
}
const eq = (got, want, msg) => ok(got === want, `${msg} (got ${JSON.stringify(got)})`);

// The clock as seconds, so a jump can be measured rather than eyeballed.
const clock = (page) =>
  page.$eval('#timer', (el) => {
    const [m, s] = el.textContent.split(':');
    return Number(m) * 60 + Number(s);
  });

const { browser, page, errors } = await openGame({ baseUrl: BASE, locale: 'de-DE' });

// Solve the board by repeatedly applying the hint the game offers. Checks the
// CARD rather than the apply button, because #hint-apply keeps its own hidden
// state from the previous hint — a card that failed to open would otherwise read
// as "can apply" and the click would hang out its whole timeout. (Same helper
// shape as win-feedback.mjs, kept local so this file stands alone.)
async function solveViaHints() {
  for (let i = 0; i < 400; i++) {
    if (await page.evaluate(() => !document.getElementById('win-overlay').hidden)) return true;
    await page.click('#hint');
    const open = await page.evaluate(() => !document.getElementById('hint-card').hidden);
    if (!open) throw new Error(`hint card did not open${errors.length ? ' — ' + errors.join(' | ') : ''}`);
    if (await page.evaluate(() => document.getElementById('hint-apply').hidden)) {
      await page.click('#hint-close');
      break;
    }
    await page.click('#hint-apply');
    await page.waitForTimeout(15);
  }
  return page.evaluate(() => !document.getElementById('win-overlay').hidden);
}

try {
  // --- the standing price, before anything is clicked -----------------------
  const label = await page.$eval('#hint', (el) => el.textContent);
  ok(/\+30/.test(label), `hint button announces the price up front: "${label}"`);
  const title = await page.$eval('#hint', (el) => el.title);
  ok(/30/.test(title) && title.length > 20, 'the button title spells the rule out');
  await page.waitForSelector('#cost-fly', { state: 'attached' });
  eq(await page.$eval('#cost-fly', (el) => el.hidden), true, 'the pill starts hidden');

  // --- the charge itself ----------------------------------------------------
  const before = await clock(page);
  await page.click('#hint');
  const flew = await page
    .waitForSelector('#cost-fly:not([hidden])', { timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  ok(flew, 'a charged hint flies a "+30 s" pill off the button');
  const pillText = await page.$eval('#cost-fly', (el) => el.textContent);
  ok(/\+30/.test(pillText), `the pill quotes the same number as the label: "${pillText}"`);
  ok(
    await page.$eval('#status', (el) => el.classList.contains('bumped')),
    'the clock pulses at the same moment, so the jump reads as a consequence'
  );

  const after = await clock(page);
  ok(
    after - before >= 30 && after - before <= 32,
    `the clock takes the 30 s live (${before} -> ${after})`
  );

  // The pill must clean up after itself, or it sits over the board for good.
  // Waited on the property, not the selector: a [hidden] element is never
  // "visible", so waitForSelector's default state can only ever time out here.
  await page.waitForFunction(() => document.getElementById('cost-fly').hidden, null, {
    timeout: 4000,
  });

  // --- the case the whole test exists for -----------------------------------
  // Same board, same deduction: hintsUsed does not bump, so nothing may be
  // charged and nothing may fly.
  await page.click('#hint-close');
  const beforeRepeat = await clock(page);
  await page.click('#hint');
  await page.waitForTimeout(400);
  eq(
    await page.$eval('#cost-fly', (el) => el.hidden),
    true,
    're-opening the same hint flies no pill'
  );
  const afterRepeat = await clock(page);
  ok(
    afterRepeat - beforeRepeat <= 1,
    `re-opening the same hint does not move the clock (${beforeRepeat} -> ${afterRepeat})`
  );
  await page.click('#hint-close');

  // --- the clock is display-only: the raw seconds must stay raw -------------
  // The real risk in this change is folding the penalty into currentElapsed()
  // instead of into renderTime(): the stored `seconds` would then already carry
  // it, and score = seconds + 30·hints would charge it a SECOND time. Solving by
  // hints puts every figure on one screen, where the arithmetic has to close:
  //   effective time (the big number, and the clock's last reading)
  //     = raw playing time + 30 · hints
  ok(await solveViaHints(), 'solved the board by applying hints');
  // stopTimer() renders once more as it freezes, so the clock's final reading is
  // the result itself — exactly, not approximately.
  const frozenClock = await clock(page);

  const card = await page.evaluate(() => ({
    score: document.querySelector('#win-time .win-score').textContent,
    breakdown: document.querySelector('#win-time .win-breakdown').textContent,
  }));
  const secs = (mmss) => {
    const [m, s] = mmss.split(':');
    return Number(m) * 60 + Number(s);
  };
  const hints = Number(card.breakdown.match(/(\d+)\s*Tipp/)[1]);
  const raw = secs(card.breakdown.match(/Spielzeit\s+(\d+:\d\d)/)[1]);
  ok(hints >= 1, `the solve really used hints (${hints})`);
  eq(
    secs(card.score),
    raw + 30 * hints,
    'effective time = playing time + 30 s per hint, charged exactly once'
  );
  ok(
    /\(\+\d+:\d\d\)/.test(card.breakdown),
    `the breakdown names the surcharge it added: "${card.breakdown}"`
  );
  ok(
    card.breakdown.startsWith('Spielzeit'),
    'the breakdown says "Spielzeit", so the raw figure cannot be read as the result'
  );
  // The clock the player last watched IS the result — that is the whole point of
  // moving the surcharge onto it.
  eq(secs(card.score), frozenClock, 'the frozen clock reads exactly the result');
  await page.click('#win-close');

  // --- layout: the longer label in the landscape button column --------------
  await page.setViewportSize({ width: 740, height: 420 });
  await page.waitForTimeout(200);
  const fit = await page.$eval('#hint', (el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    parent: el.parentElement.getBoundingClientRect().right,
    right: el.getBoundingClientRect().right,
  }));
  ok(
    fit.scroll <= fit.client + 1,
    `landscape: the label fits its button (${fit.scroll} vs ${fit.client})`
  );
  ok(fit.right <= fit.parent + 1, 'landscape: the button stays inside the action column');

  // Narrow portrait, the other end of the range.
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 780 });
    await page.waitForTimeout(150);
    const m = await page.$eval('#hint', (el) => ({
      scroll: el.scrollWidth,
      client: el.clientWidth,
    }));
    ok(m.scroll <= m.client + 1, `${width}px: the hint label is not clipped`);
  }

  ok(errors.length === 0, `no console errors (${errors.join(' | ') || 'none'})`);
} finally {
  await browser.close();
}

console.log(failed ? 'hint-cost: FAILED' : 'hint-cost: all passed');
process.exit(failed ? 1 : 0);
