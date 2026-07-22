// Browser test for Voice Mode end-to-end wiring, driven through the REAL DOM.
//
// There's no microphone in this environment, so we inject a fake
// SpeechRecognition before the page loads (addInitScript) and push transcripts
// at it via window.__fakeVoice. That exercises the whole path a real utterance
// would: recogniser → parseVoiceCommand → the same internal calls a tap/button
// makes → the board. The parser itself is unit-tested in tests/logic.
//
// Playwright + Chromium are environment-provided at fixed /opt paths (see
// tests/README.md); this only runs in that kind of environment. Start a static
// server first: `python3 -m http.server 8000`.

const PLAYWRIGHT = '/opt/node22/lib/node_modules/playwright/index.js';
const CHROMIUM = '/opt/pw-browsers/chromium';
const BASE = process.env.BASE_URL || 'http://localhost:8000';

// A minimal SpeechRecognition stand-in. Fires onstart/onend and lets the test
// emit final results shaped like the real API (results[i][a].transcript).
const FAKE = `
class FakeRecognition {
  constructor() {
    this.lang = ''; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1;
    this.onstart = null; this.onresult = null; this.onend = null; this.onerror = null;
    this._started = false;
    window.__fakeVoiceInstance = this;
  }
  start() {
    if (this._started) throw new Error('already started');
    this._started = true;
    setTimeout(() => { if (this.onstart) this.onstart(); }, 0);
  }
  stop() {
    if (!this._started) return;
    this._started = false;
    setTimeout(() => { if (this.onend) this.onend(); }, 0);
  }
  abort() { this.stop(); }
}
window.SpeechRecognition = FakeRecognition;
delete window.webkitSpeechRecognition;
// Disable speech synthesis so command processing is never suppressed by TTS
// (headless engines fire onend unreliably); the read-aloud path is fail-soft.
try { delete window.speechSynthesis; } catch (e) { window.speechSynthesis = undefined; }
window.__fakeVoice = {
  emitFinal(alternatives) {
    const inst = window.__fakeVoiceInstance;
    if (!inst || !inst.onresult) return false;
    const result = { isFinal: true, length: alternatives.length };
    alternatives.forEach((t, a) => { result[a] = { transcript: t }; });
    const results = { length: 1, 0: result };
    inst.onresult({ resultIndex: 0, results });
    return true;
  },
};
`;

let failed = 0;
function check(name, cond) {
  console.log((cond ? '  ok   ' : '  FAIL ') + name);
  if (!cond) failed++;
}

const cellState = (page, idx) =>
  page.evaluate((i) => document.querySelectorAll('.cell')[i].dataset.state, idx);

async function run() {
  const pw = (await import(PLAYWRIGHT)).default;
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.addInitScript(FAKE);
  await page.goto(BASE + '/index.html');
  await page.waitForSelector('.cell');
  await page.waitForFunction(() => {
    const c = document.querySelector('.cell');
    return c && c.dataset.state !== undefined;
  });

  const N = await page.$$eval('.cell', (cs) => Math.round(Math.sqrt(cs.length)));
  check('default board is 8×8', N === 8);

  // Every cell carries its chess coordinate, ready for the label overlay.
  const coord26 = await page.evaluate(() => document.querySelectorAll('.cell')[26].dataset.coord);
  check('cell (row3,col2) is labelled "C4"', coord26 === 'C4');

  // --- Turn Voice Mode on through the settings UI. ---
  await page.click('#open-settings');
  await page.waitForSelector('#settings-overlay:not([hidden])');
  check('voice toggle enabled (fake API supported)', !(await page.$eval('#voice-mode', (e) => e.disabled)));
  check('edge sub-option hidden before Voice Mode', !(await page.isVisible('#voice-edge-field')));
  await page.check('#voice-mode');
  check('edge sub-option shown once Voice Mode on', !(!(await page.isVisible('#voice-edge-field'))));
  await page.click('#settings-close');
  check('voice panel visible', !(await page.$eval('#voice-panel', (e) => e.hidden)));
  check('board shows coordinate labels', await page.$eval('#board', (e) => e.classList.contains('show-coords')));

  // --- The ⓘ tutorial overlay opens and closes. ---
  await page.click('#voice-help');
  check('tutorial overlay opens', !(await page.$eval('#voice-help-overlay', (e) => e.hidden)));
  check('tutorial lists commands', /C4/.test(await page.$eval('#voice-help-overlay', (e) => e.textContent)));
  await page.click('#voice-help-close');
  check('tutorial overlay closes', await page.$eval('#voice-help-overlay', (e) => e.hidden));

  // --- Start listening. ---
  await page.click('#voice-listen');
  await page.waitForFunction(() => document.getElementById('voice-listen').classList.contains('listening'));
  check('listen button shows the listening state', true);

  const emit = (alts) => page.evaluate((a) => window.__fakeVoice.emitFinal(a), alts);
  const qcoords = () => page.$$eval('.cell', (cs) => cs.filter((c) => c.dataset.state === 'queen').map((c) => c.dataset.coord));

  // --- "C4 Dame" places a queen at (row3,col2) = flat index 26. ---
  await emit(['C4 Dame']);
  await page.waitForTimeout(60);
  check('"C4 Dame" placed a queen at C4', (await cellState(page, 26)) === 'queen');
  check('voice status echoes C4', (await page.$eval('#voice-status', (e) => e.textContent)).includes('C4'));

  // --- "C4 leeren" clears the queen again (board is empty afterwards). ---
  await emit(['C4 leeren']);
  await page.waitForTimeout(60);
  check('"C4 leeren" cleared C4', (await cellState(page, 26)) === 'empty');

  // --- A bare coordinate cycles like a tap: "A1" dots (0,0) = index 0. On the
  //     now-empty board nothing is auto-marked, so this is deterministic. ---
  await emit(['A1']);
  await page.waitForTimeout(60);
  check('"A1" dotted A1 (tap cycle)', (await cellState(page, 0)) === 'dot');

  // --- Alternatives: the first that parses wins (recovers a mis-heard letter). ---
  await emit(['see for', 'C4']);
  await page.waitForTimeout(60);
  check('picks the parseable alternative "C4" over noise', (await cellState(page, 26)) === 'dot');

  // --- Batch: several cells in one breath (E2,F2,G2 = indices 12,13,14),
  //     applied as ONE undo step. ---
  await emit(['Punkte auf E2, F2, G2']);
  await page.waitForTimeout(60);
  check(
    'batch dotted E2/F2/G2 at once',
    (await cellState(page, 12)) === 'dot' &&
      (await cellState(page, 13)) === 'dot' &&
      (await cellState(page, 14)) === 'dot'
  );
  check('batch status mentions "3 Felder"', /3 Felder/.test(await page.$eval('#voice-status', (e) => e.textContent)));
  await emit(['Zurück']);
  await page.waitForTimeout(60);
  check(
    'one undo reverts the whole batch',
    (await cellState(page, 12)) === 'empty' &&
      (await cellState(page, 13)) === 'empty' &&
      (await cellState(page, 14)) === 'empty'
  );

  // --- Regression: "I5 I6"-style double-placement bug. Two combined fixes. ---
  // Quick mode is on by default (the auto-mark cascade needs it). G5,G6 share a
  // column and touch (G5 = row4,col6 = idx 38; G6 = row5,col6 = idx 46).
  await emit(['Zurücksetzen']);
  await page.waitForTimeout(40);
  // #1 Re-finalise dedup: Chrome emits "G5" then re-finalises it as "G5 G6".
  // The replay must NOT toggle G5 a second time (dot→queen) and cascade into G6.
  await emit(['G5']);
  await page.waitForTimeout(60);
  await emit(['G5 G6']);
  await page.waitForTimeout(60);
  check(
    'dup final "G5" + "G5 G6" → two dots, no queens',
    (await cellState(page, 38)) === 'dot' && (await cellState(page, 46)) === 'dot'
  );

  // #2 Frozen batch auto-mark: even a *genuine* single batch toggle where the
  // first cell turns into a queen must not flip the touching second cell into a
  // queen too. Pre-dot G5, break the dedup chain with an unrelated final, then
  // toggle both in one utterance: G5 dot→queen, G6 should still land on a dot.
  await emit(['Zurücksetzen']);
  await page.waitForTimeout(40);
  await emit(['G5']);
  await page.waitForTimeout(60);
  await emit(['Schließen']); // no card open: a no-op that resets the dedup prefix
  await page.waitForTimeout(40);
  await emit(['G5 G6']);
  await page.waitForTimeout(60);
  check(
    'batch toggle: G5→queen does not cascade G6 into a queen',
    (await cellState(page, 38)) === 'queen' && (await cellState(page, 46)) === 'dot'
  );
  await emit(['Zurücksetzen']);
  await page.waitForTimeout(40);

  // --- B2 + extended-debug journal + destructive-reset guard. ---
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await page.click('#open-settings');
  await page.waitForSelector('#settings-overlay:not([hidden])');
  check('extended-debug sub-option hidden before Debug on', !(await page.isVisible('#debug-extended-field')));
  await page.check('#debug-mode');
  check('extended-debug sub-option shown after Debug on', !(!(await page.isVisible('#debug-extended-field'))));
  await page.check('#debug-extended');
  await page.click('#settings-close');

  await emit(['Zurücksetzen']);
  await page.waitForTimeout(40);
  // B2: A1 Dame, then a MERGED "D2 Dame E4 Dame" (recogniser fused two commands).
  await emit(['A1 Dame']);
  await page.waitForTimeout(40);
  await emit(['D2 Dame E4 Dame']);
  await page.waitForTimeout(50);
  check('merged queen utterance placed A1,D2,E4', JSON.stringify(await qcoords()) === JSON.stringify(['A1', 'D2', 'E4']));
  await emit(['zurück']);
  await page.waitForTimeout(50);
  check('B2: one "zurück" removes ONLY the last queen', JSON.stringify(await qcoords()) === JSON.stringify(['A1', 'D2']));

  // Journal: the two Dame moves carry the SAME transcript (proves the merge), and
  // the undo entry records exactly which queen it removed.
  await page.click('#debug-copy');
  await page.waitForTimeout(150);
  const dbg = await page.evaluate(() => navigator.clipboard.readText());
  check('debug copy includes the move journal', /"journal"/.test(dbg));
  check(
    'journal shows the merged transcript on two moves',
    (dbg.match(/"heard": "D2 Dame E4 Dame"/g) || []).length >= 2
  );
  check('journal undo entry is traceable (removed E4)', /"op": "undo"[\s\S]*?"removed": \["E4"\]/.test(dbg));

  // A2: a bare "leeren" (mis-heard cell-clear) must NOT wipe the whole board.
  const beforeBare = JSON.stringify(await qcoords());
  await emit(['leeren']);
  await page.waitForTimeout(50);
  check('bare "leeren" does not reset the board', JSON.stringify(await qcoords()) === beforeBare);
  await emit(['Zurücksetzen']);
  await page.waitForTimeout(40);

  // --- Fill: whole columns/rows, with an exclusion. ---
  await emit(['Zurücksetzen']);
  await page.waitForTimeout(40);
  await emit(['Punkte Spalte A']);
  await page.waitForTimeout(60);
  check(
    '"Punkte Spalte A" dotted the whole column',
    await page.evaluate(() => {
      const cells = document.querySelectorAll('.cell');
      for (let r = 0; r < 8; r++) if (cells[r * 8].dataset.state !== 'dot') return false;
      return true;
    })
  );
  // Dotting a whole unit is flagged as a dead end (warning), not a plain OK.
  check(
    'whole-column fill warns about the dead end',
    await page.$eval('#voice-status', (e) => e.classList.contains('warn') && /Sackgasse/.test(e.textContent))
  );
  await emit(['Zurücksetzen']);
  await page.waitForTimeout(40);
  await emit(['Punkte Zeile eins außer Spalte C']);
  await page.waitForTimeout(60);
  check(
    '"Zeile eins außer Spalte C" dotted row 1 but skipped C1',
    await page.evaluate(() => {
      const cells = document.querySelectorAll('.cell');
      for (let c = 0; c < 8; c++) {
        const st = cells[c].dataset.state;
        if (c === 2 ? st !== 'empty' : st !== 'dot') return false;
      }
      return true;
    })
  );

  // --- Region by cell: "Region von A1" targets the region A1 lies in. ---
  await emit(['Zurücksetzen']);
  await page.waitForTimeout(40);
  await emit(['Punkte Region von A1']);
  await page.waitForTimeout(60);
  check(
    '"Region von A1" dotted the whole region of A1',
    await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.cell')];
      const reg = cells[0].dataset.region;
      return cells.every((c) => c.dataset.region !== reg || c.dataset.state === 'dot');
    })
  );

  // --- Hint pop-up by voice: opens, "OK" applies it, "Schließen" closes it. ---
  await emit(['Zurücksetzen']);
  await page.waitForTimeout(40);
  await emit(['Hinweis']);
  await page.waitForTimeout(80);
  check('"Hinweis" opened the hint card', !(await page.$eval('#hint-card', (e) => e.hidden)));
  const filledBefore = await page.$$eval('.cell', (cs) => cs.filter((c) => c.dataset.state !== 'empty').length);
  await emit(['ok']);
  await page.waitForTimeout(80);
  check('"OK" closed the hint card (applied)', await page.$eval('#hint-card', (e) => e.hidden));
  const filledAfter = await page.$$eval('.cell', (cs) => cs.filter((c) => c.dataset.state !== 'empty').length);
  check('"OK" applied the hint (board changed)', filledAfter > filledBefore);
  await emit(['Hinweis']);
  await page.waitForTimeout(80);
  await emit(['schließen']);
  await page.waitForTimeout(60);
  check('"Schließen" closed the hint card', await page.$eval('#hint-card', (e) => e.hidden));

  // --- Edge coordinate rulers: a large chess-style ruler instead of the
  //     per-cell corner labels (tested while Voice Mode is still on). ---
  await page.click('#open-settings');
  await page.waitForSelector('#settings-overlay:not([hidden])');
  await page.check('#voice-edge-mode');
  await page.click('#settings-close');
  check('edge rulers on (stage.show-edge-coords)', await page.$eval('#board-stage', (e) => e.classList.contains('show-edge-coords')));
  check('corner labels off in edge mode', !(await page.$eval('#board', (e) => e.classList.contains('show-coords'))));
  check('column ruler has N letters', (await page.$eval('#coord-cols', (e) => e.children.length)) === N);
  check('row ruler has N numbers', (await page.$eval('#coord-rows', (e) => e.children.length)) === N);
  check('first column label is "A"', (await page.$eval('#coord-cols', (e) => e.children[0].textContent)) === 'A');
  check('first row label is "1"', (await page.$eval('#coord-rows', (e) => e.children[0].textContent)) === '1');
  check('no horizontal page overflow with rulers', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  // --- "stopp" ends listening. ---
  await emit(['stopp']);
  await page.waitForFunction(
    () => !document.getElementById('voice-listen').classList.contains('listening')
  );
  check('"stopp" stopped listening', true);

  // --- Turning Voice Mode off hides the panel, the labels and the rulers. ---
  await page.click('#open-settings');
  await page.waitForSelector('#settings-overlay:not([hidden])');
  await page.uncheck('#voice-mode');
  check('edge sub-option hidden when Voice Mode off', !(await page.isVisible('#voice-edge-field')));
  await page.click('#settings-close');
  check('voice panel hidden again', await page.$eval('#voice-panel', (e) => e.hidden));
  check('coordinate labels removed', !(await page.$eval('#board', (e) => e.classList.contains('show-coords'))));
  check('edge rulers removed', !(await page.$eval('#board-stage', (e) => e.classList.contains('show-edge-coords'))));

  check('no console/page errors', errors.length === 0);
  if (errors.length) console.log('   errors:', errors);

  // --- Unsupported browser (no Web Speech API, e.g. Safari/Firefox): the
  //     feature must gate itself off cleanly. ---
  const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page2.addInitScript(`delete window.SpeechRecognition; delete window.webkitSpeechRecognition;`);
  await page2.goto(BASE + '/index.html');
  await page2.waitForSelector('.cell');
  await page2.click('#open-settings');
  await page2.waitForSelector('#settings-overlay:not([hidden])');
  check('unsupported → voice toggle disabled', await page2.$eval('#voice-mode', (e) => e.disabled));
  check(
    'unsupported → hint says so',
    /nicht verfügbar/.test(await page2.$eval('#voice-mode-hint', (e) => e.textContent))
  );

  await browser.close();
  console.log(failed === 0 ? '\nvoice-mode: all passed' : `\nvoice-mode: ${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
