// Two small onboarding guards:
//  1. Settings always open scrolled to the top (size/difficulty first), even
//     after the player scrolled down and closed them last time.
//  2. The very first solve on a device shows the "try other sizes/difficulties"
//     tip on the win card.
import { openGame } from './board-helpers.mjs';

const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };
const { browser, page } = await openGame({ locale: 'de-DE', viewport: { width: 390, height: 700 } });
const scrollTop = () => page.evaluate(() => document.querySelector('#settings-overlay .overlay-card').scrollTop);

await page.click('#open-settings');
await page.evaluate(() => { document.querySelector('#settings-overlay .overlay-card').scrollTop = 500; });
if ((await scrollTop()) === 0) fail('settings card is not scrollable at 390x700 — test would prove nothing');
await page.click('#settings-close');
await page.click('#open-settings');
if ((await scrollTop()) !== 0) fail(`settings reopened at scrollTop ${await scrollTop()}, expected 0`);
await page.click('#settings-close');

for (let i = 0; i < 400; i++) {
  if (await page.evaluate(() => !document.getElementById('win-overlay').hidden)) break;
  await page.click('#hint');
  if (await page.evaluate(() => document.getElementById('hint-apply').hidden)) { await page.click('#hint-close'); break; }
  await page.click('#hint-apply');
  await page.waitForTimeout(15);
}
const tip = await page.evaluate(() => { const e = document.getElementById('win-tip'); return e.hidden ? null : e.textContent; });
if (!tip || !/erster Sieg/.test(tip)) fail(`first-win tip missing: ${tip}`);
await browser.close();
if (!process.exitCode) console.log('ok onboarding-tips');
