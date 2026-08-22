// Browser test for the QR share dialog (settings → the small QR button in the
// title row). What it guards:
//
//   * The button really sits in the heading row, at the right edge and level
//     with "Einstellungen" — the whole point of putting it there was that it
//     costs no vertical space and stays out of the crowded top bar.
//   * The dialog LAYERS on the settings: they stay open behind it, so closing
//     the code returns there instead of dumping the player back on the board.
//     Escape therefore has to take the code first, not both at once.
//   * The rendered code is big enough to scan from another phone and the card
//     fits a phone screen without scrolling.
//   * The address under the code is the one the code encodes (the *content* of
//     the code is checked in tests/logic/qr-code.mjs, which decodes it).
//
// Prereqs: static server on BASE_URL (default http://localhost:8000) and the
// environment's Playwright/Chromium (see board-helpers.mjs). Run with:
//
//   python3 -m http.server 8000 &
//   node tests/browser/qr-share.mjs

import { openGame } from './board-helpers.mjs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const SHARE_URL = 'https://ilianp.github.io/Queens-clone/';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !extra ? '' : ' — ' + extra}`);
  if (!ok) failed++;
};

// Pinned to German: the dialog is opened from the German settings card here,
// and the widest of the four packs is the one that has to fit the narrow card
// (all four are measured in i18n-layout.mjs).
const { browser, page, errors } = await openGame({ baseUrl: BASE_URL, locale: 'de-DE' });
try {
  const box = (sel) => page.locator(sel).boundingBox();

  await page.click('#open-settings');
  await page.waitForSelector('#settings-overlay:not([hidden])');
  await page.waitForTimeout(300); // the card's rise animation

  const h2 = await box('.settings-head h2');
  const btn = await box('#open-qr');
  const card = await box('.settings-card');
  check('share button sits right of the heading', btn.x >= h2.x + h2.width - 1);
  check('share button stays inside the card', btn.x + btn.width <= card.x + card.width + 1);
  check(
    'share button is level with the heading',
    Math.abs(btn.y + btn.height / 2 - (h2.y + h2.height / 2)) < 6,
    `heading mid ${h2.y + h2.height / 2}, button mid ${btn.y + btn.height / 2}`
  );
  check('share button is a real touch target', btn.width >= 36 && btn.height >= 36,
    `${btn.width}×${btn.height}`);

  await page.click('#open-qr');
  await page.waitForSelector('#qr-overlay:not([hidden])');
  await page.waitForTimeout(300);
  check('settings stay open behind the code', await page.locator('#settings-overlay').isVisible());

  const qr = await box('.qr-code svg');
  check('code renders square', Math.abs(qr.width - qr.height) < 2, `${qr.width}×${qr.height}`);
  check('code is large enough to scan', qr.width >= 150, `${qr.width}px wide`);

  const viewport = page.viewportSize();
  const qrCard = await box('.qr-card');
  check(
    'card fits the phone screen',
    qrCard.y >= 0 && qrCard.y + qrCard.height <= viewport.height,
    `y ${qrCard.y}, bottom ${qrCard.y + qrCard.height} of ${viewport.height}`
  );

  const href = await page.getAttribute('.qr-url a', 'href');
  check(`the link points at ${SHARE_URL}`, href === SHARE_URL, String(href));

  // Escape: the code first, the settings only on the second press. One press
  // closing both would drop the player straight back on the board.
  await page.keyboard.press('Escape');
  check(
    'Escape closes only the code',
    (await page.locator('#qr-overlay').isHidden()) &&
      (await page.locator('#settings-overlay').isVisible())
  );
  await page.keyboard.press('Escape');
  check('a second Escape closes the settings', await page.locator('#settings-overlay').isHidden());

  // Tapping the dimmed backdrop is the other way out, and must behave the same.
  await page.click('#open-settings');
  await page.click('#open-qr');
  await page.waitForSelector('#qr-overlay:not([hidden])');
  await page.waitForTimeout(300);
  await page.mouse.click(viewport.width / 2, 20);
  check(
    'backdrop tap closes only the code',
    (await page.locator('#qr-overlay').isHidden()) &&
      (await page.locator('#settings-overlay').isVisible())
  );

  // The close button inside the dialog.
  await page.click('#open-qr');
  await page.waitForSelector('#qr-overlay:not([hidden])');
  await page.waitForTimeout(300);
  await page.click('#qr-close');
  check(
    'the close button returns to the settings',
    (await page.locator('#qr-overlay').isHidden()) &&
      (await page.locator('#settings-overlay').isVisible())
  );

  check('no console errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}

console.log(failed === 0 ? '\nqr-share: all passed' : `\nqr-share: ${failed} FAILED`);
process.exit(failed ? 1 : 0);
