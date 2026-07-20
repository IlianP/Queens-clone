// Pure-logic checks for parseVoiceCommand() — the German-transcript → command
// parser behind Voice Mode. No browser, no deps (voice.js touches `window` only
// inside the recogniser wrapper, never at import time):
//   node tests/logic/voice-parse.mjs
import { parseVoiceCommand, coordLabel, colLetter } from '../../js/voice.js';

let failed = 0;
function check(name, cond) {
  if (cond) {
    console.log('  ok   ' + name);
  } else {
    console.log('  FAIL ' + name);
    failed++;
  }
}
// Compact equality for the { type, row, col, action } shape.
function cellIs(cmd, row, col, action) {
  return (
    cmd.type === 'cell' && cmd.row === row && cmd.col === col && (!action || cmd.action === action)
  );
}
function actionIs(cmd, action) {
  return cmd.type === 'action' && cmd.action === action;
}

// --- Coordinate labelling maps the way the data model expects. ---
check('coordLabel(3,2) === "C4"', coordLabel(3, 2) === 'C4');
check('colLetter(0) === "A"', colLetter(0) === 'A');
check('colLetter(11) === "L"', colLetter(11) === 'L');

// --- Bare coordinate → toggle (cycles like a tap). Letter=col, number=row. ---
check('"C4" → toggle (3,2)', cellIs(parseVoiceCommand('C4', 8), 3, 2, 'toggle'));
check('"c 4" spaced → (3,2)', cellIs(parseVoiceCommand('c 4', 8), 3, 2, 'toggle'));
check('"4c" reversed glued → (3,2)', cellIs(parseVoiceCommand('4c', 8), 3, 2, 'toggle'));

// --- German spelling alphabet + spoken number words. ---
check('"Cäsar vier" → (3,2)', cellIs(parseVoiceCommand('Cäsar vier', 8), 3, 2));
check('"anton eins" → (0,0)', cellIs(parseVoiceCommand('anton eins', 8), 0, 0));
check('"ludwig zwölf" on 12 → (11,11)', cellIs(parseVoiceCommand('ludwig zwölf', 12), 11, 11));
check('number-before-letter "vier cäsar" → (3,2)', cellIs(parseVoiceCommand('vier cäsar', 8), 3, 2));

// --- Action verbs pick the cell action. ---
check('"C4 Dame" → queen', cellIs(parseVoiceCommand('C4 Dame', 8), 3, 2, 'queen'));
check('"Dame auf C4" → queen', cellIs(parseVoiceCommand('Dame auf C4', 8), 3, 2, 'queen'));
check('"C4 setzen" → queen', cellIs(parseVoiceCommand('C4 setzen', 8), 3, 2, 'queen'));
check('"C4 Punkt" → mark', cellIs(parseVoiceCommand('C4 Punkt', 8), 3, 2, 'mark'));
check('"C4 markieren" → mark', cellIs(parseVoiceCommand('C4 markieren', 8), 3, 2, 'mark'));
check('"C4 leeren" → clear', cellIs(parseVoiceCommand('C4 leeren', 8), 3, 2, 'clear'));
check('"C4 löschen" → clear', cellIs(parseVoiceCommand('C4 löschen', 8), 3, 2, 'clear'));

// --- Out-of-range coordinates are rejected, not clamped. ---
check('col L on a 5-board → none', parseVoiceCommand('ludwig eins', 5).type === 'none');
check('row 9 on an 8-board → none', parseVoiceCommand('a neun', 8).type === 'none');

// --- Several coordinates in one breath → a batch with one shared action. ---
function batchIs(cmd, action, cells) {
  if (cmd.type !== 'batch' || cmd.action !== action) return false;
  if (cmd.cells.length !== cells.length) return false;
  return cmd.cells.every((c, i) => c.row === cells[i][0] && c.col === cells[i][1]);
}
check(
  '"Punkte auf A2, B2, C3" → batch mark of 3',
  batchIs(parseVoiceCommand('Punkte auf A2, B2, C3', 8), 'mark', [[1, 0], [1, 1], [2, 2]])
);
check(
  '"A2 B2" (no verb) → batch toggle of 2',
  batchIs(parseVoiceCommand('A2 B2', 8), 'toggle', [[1, 0], [1, 1]])
);
check(
  '"Damen auf A2 und B5" → batch queen of 2',
  batchIs(parseVoiceCommand('Damen auf A2 und B5', 8), 'queen', [[1, 0], [4, 1]])
);
check(
  '"Cäsar vier Dora zwei" spelled → batch of 2',
  batchIs(parseVoiceCommand('Cäsar vier Dora zwei', 8), 'toggle', [[3, 2], [1, 3]])
);
// A repeat in one breath collapses to a single cell (not a 2-cell batch).
check('"A2 A2" → single cell (deduped)', cellIs(parseVoiceCommand('A2 A2', 8), 1, 0));
// Invalid coordinates drop out of a batch; one survivor → a plain cell command.
check(
  '"Punkt auf A2 und L1" on 5-board → just A2',
  cellIs(parseVoiceCommand('Punkt auf A2 und L1', 5), 1, 0, 'mark')
);

// --- Whole-line / region fills with an exclusion set. ---
function specEq(s, w) {
  if (s.kind !== w[0]) return false;
  if (w[0] === 'color') return s.name === w[1];
  if (w[0] === 'regionAt') return s.row === w[1] && s.col === w[2];
  return s.v === w[1]; // col / row
}
function specsEqual(got, want) {
  return got.length === want.length && got.every((s, i) => specEq(s, want[i]));
}
function fillIs(cmd, action, include, exclude) {
  return (
    cmd.type === 'fill' &&
    cmd.action === action &&
    specsEqual(cmd.include, include) &&
    specsEqual(cmd.exclude, exclude)
  );
}
check(
  '"Punkte Spalte B und C außer rot" → fill mark, cols B/C, except red',
  fillIs(parseVoiceCommand('Punkte Spalte B und C außer rot', 8), 'mark', [['col', 1], ['col', 2]], [['color', 'red']])
);
check(
  '"Punkte Zeile 2 und 3 außer Spalte D" → fill mark, rows 2/3, except col D',
  fillIs(parseVoiceCommand('Punkte Zeile zwei und drei außer Spalte D', 8), 'mark', [['row', 1], ['row', 2]], [['col', 3]])
);
check(
  '"leere Spalte A" → fill clear of col A',
  fillIs(parseVoiceCommand('leere Spalte A', 8), 'clear', [['col', 0]], [])
);
check(
  '"Punkte grün" → fill mark of the green region',
  fillIs(parseVoiceCommand('Punkte grün', 8), 'mark', [['color', 'green']], [])
);
// A bare coordinate list stays a batch (no unit word → not a fill).
check('"A2 B2" stays a batch (not a fill)', parseVoiceCommand('A2 B2', 8).type === 'batch');

// Region-by-cell: name a region by a cell that lies in it.
check(
  '"Punkte Region von C3" → fill mark, region at C3',
  fillIs(parseVoiceCommand('Punkte Region von C3', 8), 'mark', [['regionAt', 2, 2]], [])
);
check(
  '"Punkte Spalte B außer Region C3" → col B, except region at C3',
  fillIs(parseVoiceCommand('Punkte Spalte B außer Region C3', 8), 'mark', [['col', 1]], [['regionAt', 2, 2]])
);
// "alles" was dropped: dotting the whole board has no solving logic, so it's not
// a fill command any more.
check('"Punkte alles" is not a fill', parseVoiceCommand('Punkte alles', 8).type !== 'fill');
// A colour still wins inside a region context ("Region Rot" = the red region).
check(
  '"Punkte Region rot" → colour, not region-at',
  fillIs(parseVoiceCommand('Punkte Region rot', 8), 'mark', [['color', 'red']], [])
);

// --- Context commands for an open card (hint pop-up). ---
check('"ok" → apply', actionIs(parseVoiceCommand('ok', 8), 'apply'));
check('"übernehmen" → apply (ü boundary)', actionIs(parseVoiceCommand('übernehmen', 8), 'apply'));
check('"schließen" → dismiss', actionIs(parseVoiceCommand('schließen', 8), 'dismiss'));
check('"wiederholen" → repeat', actionIs(parseVoiceCommand('wiederholen', 8), 'repeat'));
check('"vorlesen" → repeat', actionIs(parseVoiceCommand('vorlesen', 8), 'repeat'));

// --- A1: a real cell/fill command beats a leading filler word (ja/ok/…). ---
check('"ja C4 Dame" → cell C4 queen (filler doesn\'t hijack)', cellIs(parseVoiceCommand('ja C4 Dame', 8), 3, 2, 'queen'));
check('"okay C3 Punkt" → cell C3 mark', cellIs(parseVoiceCommand('okay C3 Punkt', 8), 2, 2, 'mark'));

// --- A2: a bare cell-clear verb must NOT reset the whole board. ---
check('bare "leeren" → NOT reset (falls through to none)', parseVoiceCommand('leeren', 8).type === 'none');
check('bare "löschen" → NOT reset', parseVoiceCommand('löschen', 8).type === 'none');
check('"C6 leeren" → cell clear (coordinate kept)', cellIs(parseVoiceCommand('C6 leeren', 8), 5, 2, 'clear'));
check('"alles leeren" → reset (explicit)', actionIs(parseVoiceCommand('alles leeren', 8), 'reset'));
check('"ganzes Feld leeren" → reset (explicit)', actionIs(parseVoiceCommand('ganzes Feld leeren', 8), 'reset'));

// --- Global actions (no coordinate present). ---
check('"neues Spiel" → newGame', actionIs(parseVoiceCommand('neues Spiel', 8), 'newGame'));
check('"Hinweis" → hint', actionIs(parseVoiceCommand('Hinweis bitte', 8), 'hint'));
check('"Tipp" → hint', actionIs(parseVoiceCommand('Tipp', 8), 'hint'));
check('"prüfen" → check', actionIs(parseVoiceCommand('prüfen', 8), 'check'));
check('"zurück" → undo', actionIs(parseVoiceCommand('zurück', 8), 'undo'));
check('"rückgängig" → undo', actionIs(parseVoiceCommand('rückgängig', 8), 'undo'));
// "zurücksetzen" contains "zurück": reset must win over undo.
check('"zurücksetzen" → reset (not undo)', actionIs(parseVoiceCommand('zurücksetzen', 8), 'reset'));

// --- Stop always wins. ---
check('"stopp" → stop', parseVoiceCommand('stopp', 8).type === 'stop');
check('"pause" → stop', parseVoiceCommand('pause', 8).type === 'stop');

// --- Garbage / empty → none. ---
check('empty → none', parseVoiceCommand('', 8).type === 'none');
check('"guten morgen" → none', parseVoiceCommand('guten morgen', 8).type === 'none');

console.log(failed === 0 ? '\nvoice-parse: all passed' : `\nvoice-parse: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
