// i18n/en.js — English language pack, and the fallback every other pack is
// measured against (see I18N_FALLBACK in js/i18n.js).
//
// See js/i18n/de.js for the conventions all packs share: identical key sets,
// values are strings or functions of one params object, emoji stay untranslated.
//
// Bundle constraint (this file is concatenated into the classic-script Artifact
// bundle): no `import.meta`, and no top-level name collisions — hence the
// en-prefixed helper names.

// English plural: only 1 is singular.
const enPlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// 1st, 2nd, 3rd, 4th … (11th/12th/13th are the exceptions).
const enOrdinal = (n) => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
  return `${n}${suffix}`;
};

export const I18N_EN = {
  // ---------- meta ----------
  'lang.htmlLang': 'en',
  'lang.locale': 'en-GB',

  // ---------- top bar / actions ----------
  'ui.newGame': 'New game',
  'ui.leaderboard': 'Leaderboard',
  'ui.settings': 'Settings',
  'ui.board': 'Game board',
  'ui.check': '🔎 Check',
  'ui.hint': '💡 Hint',
  'ui.undo': '↶ Undo',
  'ui.reset': '🔄 Reset',
  'ui.debugCopy': '🐞 Copy debug',
  'ui.sound.mute': 'Mute sound',
  'ui.sound.unmute': 'Unmute sound',
  'ui.sound.on': 'Sound on',
  'ui.sound.off': 'Sound off',
  'ui.footerHint':
    'One tap per cell: empty → dot → 👑 → empty. One queen per row, column and colour – and no two may touch.',

  // ---------- board messages ----------
  'msg.almost': 'Almost! There are still conflicts.',
  'check.errors': '✗ There are mistakes',
  'check.ok': '✓ No mistakes',

  // ---------- difficulty ----------
  'difficulty.easy': 'Easy',
  'difficulty.medium': 'Medium',
  'difficulty.hard': 'Hard',
  'bucket.label': ({ size, difficulty }) => `${size}×${size} · ${difficulty}`,

  // ---------- durations ----------
  'time.seconds': ({ seconds }) => `${seconds} s`,
  'time.minutes': ({ time }) => `${time} min`,

  // ---------- score lists ----------
  'score.empty': 'No entries yet – be the first!',
  'score.anonymous': 'Anonymous',
  'score.you': 'You',
  'score.rowTitle': ({ time, hints, mistakes }) =>
    `Time ${time} · ${enPlural(hints, 'hint', 'hints')} · ${enPlural(mistakes, 'mistake', 'mistakes')}`,

  // ---------- win card ----------
  'win.title': '🎉 Solved!',
  'win.tab.local': 'Local',
  'win.tab.global': 'Global 🌐',
  'win.nickname.placeholder': 'Your name',
  'win.nickname.aria': 'Your name for the leaderboard',
  'win.submit': 'Submit',
  'win.save': 'Save',
  'win.retry': 'Try again',
  'win.newGame': 'New game',
  'win.settings': '⚙ Settings',
  'win.debugCopy': '📋 Copy debug state',
  'win.breakdown': ({ time, hints, mistakes }) =>
    `Time ${time} · ${enPlural(hints, 'hint', 'hints')} · ${enPlural(mistakes, 'mistake', 'mistakes')}`,

  // Relative feedback on the fresh solve (personal, offline, before any submit).
  'win.personal.first': ({ bucket }) => `Your first game at ${bucket} – from now on there's something to beat.`,
  'win.personal.best': '🏆 New best time!',
  'win.personal.bestDetail': ({ delta, bucket }) => `${delta} faster than your previous record · ${bucket}`,
  'win.personal.rank': ({ rank, total }) => `Your ${enOrdinal(rank)}-best of ${total} games`,
  'win.personal.percentile': ({ percent, total, capped }) =>
    `Better than ${percent} % of your ${capped ? `last ${total}` : total} games`,
  'win.personal.detail': ({ bucket, toBest }) => `${bucket} · ${toBest}`,
  'win.personal.detailRank': ({ rank, total, bucket, toBest }) =>
    `Rank ${rank} of ${total} · ${bucket} · ${toBest}`,
  'win.personal.toBest.equal': 'level with your best time',
  'win.personal.toBest.delta': ({ delta }) => `+${delta} off your best time`,

  // ---------- global leaderboard ----------
  'global.loading': 'Loading global leaderboard …',
  'global.unreachable': 'Global leaderboard unreachable.',
  'global.notSubmitted': 'Not submitted yet – “Submit” adds you here.',
  'submit.savedLocal': 'Saved locally ✓',
  'submit.sending': 'Sending to the global leaderboard …',
  'submit.retrying': ({ attempt, total }) => `Retrying … (${attempt}/${total})`,
  'submit.done': ({ rank, total }) => `Submitted: rank ${rank} of ${total} 🌐`,
  'submit.donePercentile': ({ rank, total, percent }) =>
    `Submitted: rank ${rank} of ${total} – better than ${percent} % of all entries 🌐`,
  'submit.unreachable': 'Global leaderboard unreachable – saved locally ✓. Try again?',
  'submit.rejectedSaved': ({ text }) => `${text} – saved locally ✓`,
  'submit.reject.implausibleTime': 'Rejected globally: time judged impossible',
  'submit.reject.badCounters': 'Rejected globally: hint/mistake count outside the allowed range',
  'submit.reject.badSize': 'Rejected globally: board size not allowed',
  'submit.reject.badDifficulty': 'Rejected globally: difficulty not allowed',
  'submit.reject.rateLimited': 'Too many entries in a short time – try again in a minute',
  'submit.reject.unknown': ({ reason }) => `Rejected globally (“${reason}”)`,
  'submit.reject.generic': 'Rejected globally',

  // ---------- settings ----------
  'settings.title': 'Settings',
  'settings.size': 'Board size',
  'settings.difficulty': 'Difficulty',
  'settings.difficulty.hardOnly': 'At board size 12 only hard puzzles are possible.',
  'settings.language.label': 'Language',
  'settings.language.auto': 'Automatic (browser)',
  'settings.language.hint':
    'Switching the language reloads the game – a game in progress is lost.',
  'settings.language.confirm':
    'Switch language now? The game reloads and the game in progress is lost.',
  'settings.quick.label': 'Quick mode',
  'settings.quick.hint':
    'Placing a queen automatically dots its row, column, colour region and the neighbouring cells.',
  'settings.live.label': 'Live check',
  'settings.live.hint':
    'Continuously shows a status lamp for whether your board is still error-free – without revealing where a mistake is. It appears shortly after your last move. Without this option the status is available any time via “Check”.',
  'settings.intro.label': 'Intro animation',
  'settings.intro.hint':
    'While a puzzle is generated the colour regions spread out in an animation as the board rotates – it fills the wait on large boards.',
  'settings.sound.label': 'Sound',
  'settings.sound.hint':
    'Short, discreet sound effects for placing a queen, dotting, hints and solving. Can also be muted directly via the speaker icon at the top.',
  'settings.voice.label': 'Voice control (beta)',
  'settings.voice.hint':
    'Steer the game with your voice (Chrome/Edge, microphone required). The ⓘ in the voice panel explains every command.',
  'settings.voice.unsupported': ' Note: not available in this browser.',
  'settings.voice.germanOnly':
    ' Voice commands are German only for now – set the language to Deutsch to use them.',
  'settings.voiceEdge.label': 'Large coordinates along the edge',
  'settings.voiceEdge.hint':
    'Shows the column letters and row numbers large along the edge of the board – like a chessboard – instead of small in each cell’s corner.',
  'settings.debug.label': 'Debug mode',
  'settings.debug.hint':
    'Shows a button that copies everything about the current board (including the hint) to the clipboard – useful when reporting a problem.',
  'settings.debugExt.label': 'Extended debug mode',
  'settings.debugExt.hint':
    'Records the last 10 moves (including the voice transcript) and what each “Undo” removed. This log is included in “Copy debug” – useful when reporting voice-mode problems.',
  'settings.note': 'Changes to size or difficulty apply to the next new game.',
  'settings.apply': 'Apply & new game',
  'settings.close': 'Close',

  // ---------- leaderboard modal ----------
  'lb.title': '🏆 Leaderboard',

  // ---------- hint card chrome ----------
  'hintcard.apply': 'Apply',
  'hintcard.close': 'Close',
  'legend.reason': 'reason',
  'legend.target': 'place here',
  'legend.x': 'ruled out',

  // ---------- debug ----------
  'debug.copied': '✓ Copied',
  'debug.copyFailed': 'Copy failed',
  'debug.copiedSuffix': ' (debug copied 📋)',

  // ---------- party mode ----------
  'party.kicker': 'Achievement unlocked',
  'party.title': 'Party mode',
  'party.text':
    'You really did dot <strong>every single cell</strong> – not one queen far and wide. Absolute chaos. We are deeply impressed. 🎉',
  'party.close': 'End party',

  // ---------- hints (js/hint.js) ----------
  'hint.unit.region': 'colour region',
  'hint.unit.row': 'row',
  'hint.unit.col': 'column',

  'hint.apply.placeQueen': 'Place queen',
  'hint.apply.markCell': 'Mark cell',
  'hint.apply.markCells': 'Mark cells',
  'hint.apply.removeQueen': 'Remove queen',
  'hint.apply.removeMark': 'Remove mark',

  'hint.place.title': ({ unit }) => `Only one cell left in the ${unit}`,
  'hint.place.text': ({ unit }) =>
    `This is the only cell still free in that ${unit} – every other one is ruled out. The queen has to go here.`,

  'hint.confine.colorRow.title': 'Colour fixes the row',
  'hint.confine.colorRow.text':
    'Every possible cell of this colour lies in one row. So that row’s queen belongs to this colour – the remaining cells of the row are ruled out.',
  'hint.confine.colorCol.title': 'Colour fixes the column',
  'hint.confine.colorCol.text':
    'Every possible cell of this colour lies in one column. So that column’s queen belongs to this colour – the remaining cells of the column are ruled out.',
  'hint.confine.rowColor.title': 'Row fixes the colour',
  'hint.confine.rowColor.text':
    'Only cells of a single colour are still possible in this row. So that colour’s queen lies in this row – its cells in other rows are ruled out.',
  'hint.confine.colColor.title': 'Column fixes the colour',
  'hint.confine.colColor.text':
    'Only cells of a single colour are still possible in this column. So that colour’s queen lies in this column – its cells in other columns are ruled out.',

  'hint.deadEnd.title': ({ unit }) => `Would block a ${unit}`,
  'hint.deadEnd.text': ({ unit, many }) =>
    `A queen on ${many ? 'any of these cells' : 'this cell'} would rule out every remaining free cell of that ${unit} (same row, column, colour or directly adjacent). But since that ${unit} needs a queen, ${many ? 'these cells are out' : 'this cell is out'}.`,

  'hint.crowd.rowsRegions.title': ({ k }) => `${k} colours fit into only ${k} rows`,
  'hint.crowd.rowsRegions.text': ({ k }) =>
    `The ${k} highlighted rows contain only ${k} colours. Those ${k} colours must therefore go into exactly these rows – the same colours are ruled out in every other row (hatched).`,
  'hint.crowd.colsRegions.title': ({ k }) => `${k} colours fit into only ${k} columns`,
  'hint.crowd.colsRegions.text': ({ k }) =>
    `The ${k} highlighted columns contain only ${k} colours. Those ${k} colours must therefore go into exactly these columns – the same colours are ruled out in every other column (hatched).`,
  'hint.crowd.regionsRows.title': ({ k }) => `${k} colours occupy ${k} rows`,
  'hint.crowd.regionsRows.text': ({ k }) =>
    `The ${k} highlighted colours fit into only ${k} rows. Those rows therefore belong to these colours – other colours are ruled out in these rows (hatched).`,
  'hint.crowd.regionsCols.title': ({ k }) => `${k} colours occupy ${k} columns`,
  'hint.crowd.regionsCols.text': ({ k }) =>
    `The ${k} highlighted colours fit into only ${k} columns. Those columns therefore belong to these colours – other colours are ruled out in these columns (hatched).`,

  'hint.mistake.queen.title': 'This queen doesn’t fit',
  'hint.mistake.queen.text':
    'This queen cannot be part of the solution. Take it back and try a different spot.',
  'hint.markedSolution.place.title': 'The queen belongs here',
  'hint.markedSolution.place.text': ({ unit }) =>
    `This cell is dotted as ruled out – yet it is the only cell still free in its ${unit}. Remove the dot and place the queen here.`,
  'hint.markedSolution.mistake.title': 'A queen belongs here',
  'hint.markedSolution.mistake.text':
    'This cell is dotted as ruled out even though a queen has to go here. Remove the dot.',

  'hint.solved.title': 'All solved',
  'hint.solved.text': 'Every queen is in the right place – well done!',
  'hint.reveal.title': 'Next queen',
  'hint.reveal.text': 'The next queen belongs here.',
  'hint.none.title': 'No hint',
  'hint.none.text': 'No simple hint is available right now.',
};
