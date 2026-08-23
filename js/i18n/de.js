// i18n/de.js — German language pack.
//
// See js/i18n.js for the contract. Two rules this file (and every sibling pack)
// lives by:
//   - Every pack carries EXACTLY the same keys. tests/logic/verify-i18n.mjs
//     fails the build otherwise, so a new string can't land in one language only.
//   - A value is either a string or a function of one params object. Composed
//     sentences are functions rather than "%s" templates on purpose: word order,
//     gender and agreement differ per language, so each pack writes its own
//     sentence instead of filling someone else's slots.
//
// Emoji are part of the value ("🔎 Prüfen"). They are NOT translated — keep them
// as they are and translate only the words around them.
//
// Bundle constraint (this file is concatenated into the classic-script Artifact
// bundle): no `import.meta`, and no top-level name collisions — hence the
// de-prefixed helper names.

// German plural: only 1 is singular.
const dePlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// German writes "88 %" WITH a space (DIN 5008) — a non-breaking one, so the
// sign never wraps to its own line. Intl/CLDR owns that rule; see js/i18n/en.js
// for why this helper is per-pack rather than shared.
const deLocale = 'de-DE';
const dePercent = (n) =>
  new Intl.NumberFormat(deLocale, { style: 'percent', maximumFractionDigits: 0 }).format(Number(n) / 100);

// Age of a leaderboard entry ("vor 3 Tagen") and its exact date. Intl owns both
// wordings: relative time has its own irregulars per language ("gestern", not
// "vor 1 Tag"), and a date format is a locale convention, not a translation.
// `numeric: 'auto'` is what buys those irregulars; 'short' keeps a row narrow.
const deRelTime = new Intl.RelativeTimeFormat(deLocale, { numeric: 'auto', style: 'short' });
const deDateTime = new Intl.DateTimeFormat(deLocale, { dateStyle: 'medium', timeStyle: 'short' });

export const I18N_DE = {
  // ---------- meta ----------
  'lang.htmlLang': 'de',

  // ---------- top bar / actions ----------
  'ui.newGame': 'Neues Spiel',
  'ui.leaderboard': 'Bestenliste',
  'ui.settings': 'Einstellungen',
  'ui.board': 'Spielfeld',
  'ui.check': '🔎 Prüfen',
  'ui.hint': '💡 Hinweis',
  'ui.undo': '↶ Rückgängig',
  'ui.reset': '🔄 Zurücksetzen',
  'ui.debugCopy': '🐞 Debug kopieren',
  'ui.sound.mute': 'Ton stummschalten',
  'ui.sound.unmute': 'Ton einschalten',
  'ui.sound.on': 'Ton an',
  'ui.sound.off': 'Ton aus',
  'ui.footerHint':
    'Ein Tipp pro Feld: leer → Punkt → 👑 → leer. Eine Dame pro Zeile, Spalte und Farbe – und keine zwei dürfen sich berühren.',

  // ---------- board messages ----------
  'msg.almost': 'Fast! Es gibt noch Konflikte.',
  'check.errors': '✗ Es gibt Fehler',
  'check.ok': '✓ Keine Fehler',

  // ---------- difficulty ----------
  'difficulty.easy': 'Leicht',
  'difficulty.medium': 'Mittel',
  'difficulty.hard': 'Schwer',
  'bucket.label': ({ size, difficulty }) => `${size}×${size} · ${difficulty}`,

  // ---------- durations ----------
  'time.seconds': ({ seconds }) => `${seconds} s`,
  'time.minutes': ({ time }) => `${time} min`,

  // ---------- score lists ----------
  'score.empty': 'Noch keine Einträge – sei die/der Erste!',
  'score.anonymous': 'Anonym',
  'score.you': 'Du',
  'score.rowTitle': ({ time, hints, mistakes }) =>
    `Zeit ${time} · ${dePlural(hints, 'Tipp', 'Tipps')} · ${dePlural(mistakes, 'Fehler', 'Fehler')}`,
  // `unit` arrives as an Intl unit kind ('day', 'month', …), never as a word —
  // the fallback only catches a caller passing something else entirely.
  'score.age': ({ value, unit }) => deRelTime.format(-value, typeof unit === 'string' ? unit : 'day'),
  'score.rowDate': ({ at }) => `Eingetragen: ${deDateTime.format(new Date(at))}`,

  // ---------- win card ----------
  'win.title': '🎉 Gelöst!',
  'win.tab.local': 'Lokal',
  'win.tab.global': 'Global 🌐',
  'win.tab.period': ({ days }) => `${days} Tage`,
  'win.tab.periodAria': ({ days }) => `Bestenliste der letzten ${days} Tage`,
  'win.nickname.placeholder': 'Dein Name',
  'win.nickname.aria': 'Dein Name für die Bestenliste',
  'win.submit': 'Eintragen',
  'win.save': 'Speichern',
  'win.retry': 'Erneut versuchen',
  'win.newGame': 'Neues Spiel',
  'win.settings': '⚙ Einstellungen',
  'win.debugCopy': '📋 Debug-Status kopieren',
  'win.breakdown': ({ time, hints, mistakes }) =>
    `Zeit ${time} · ${dePlural(hints, 'Tipp', 'Tipps')} · ${dePlural(mistakes, 'Fehler', 'Fehler')}`,

  // Relative feedback on the fresh solve (personal, offline, before any submit).
  'win.personal.first': ({ bucket }) => `Deine erste Partie in ${bucket} – ab jetzt gibt es etwas zu schlagen.`,
  'win.personal.best': '🏆 Neue Bestzeit!',
  'win.personal.bestDetail': ({ delta, bucket }) => `${delta} besser als dein bisheriger Rekord · ${bucket}`,
  'win.personal.rank': ({ rank, total }) => `Deine ${rank}.-beste von ${total} Partien`,
  'win.personal.percentile': ({ percent, total, capped }) =>
    `Besser als ${dePercent(percent)} ${capped ? `deiner letzten ${total}` : `deiner ${total}`} Partien`,
  'win.personal.detail': ({ bucket, toBest }) => `${bucket} · ${toBest}`,
  'win.personal.detailRank': ({ rank, total, bucket, toBest }) =>
    `Platz ${rank} von ${total} · ${bucket} · ${toBest}`,
  // The same comparison over a rolling window: how the solve stacks up against
  // current form, not against a record that may be a year old.
  'win.personal.recentBest': ({ days }) => `🔥 Deine beste Zeit der letzten ${days} Tage`,
  'win.personal.recentPercentile': ({ percent, total, days }) =>
    `Letzte ${days} Tage: besser als ${dePercent(percent)} von ${dePlural(total, 'Partie', 'Partien')}`,
  'win.personal.recentRank': ({ rank, total, days }) =>
    `Letzte ${days} Tage: Platz ${rank} von ${total}`,
  'win.personal.toBest.equal': 'gleichauf mit deiner Bestzeit',
  'win.personal.toBest.delta': ({ delta }) => `+${delta} zur Bestzeit`,

  // ---------- global leaderboard ----------
  'global.loading': 'Lade globale Bestenliste …',
  'global.unreachable': 'Globale Bestenliste nicht erreichbar.',
  'global.notSubmitted': 'Noch nicht eingetragen – „Eintragen" trägt dich hier ein.',
  'submit.savedLocal': 'Lokal gespeichert ✓',
  'submit.sending': 'Sende an globale Bestenliste …',
  'submit.retrying': ({ attempt, total }) => `Erneuter Versuch … (${attempt}/${total})`,
  'submit.done': ({ rank, total }) => `Global eingetragen: Platz ${rank} von ${total} 🌐`,
  'submit.donePercentile': ({ rank, total, percent }) =>
    `Global eingetragen: Platz ${rank} von ${total} – besser als ${dePercent(percent)} der Einträge 🌐`,
  'submit.unreachable': 'Global nicht erreichbar – lokal gespeichert ✓. Erneut versuchen?',
  'submit.rejectedSaved': ({ text }) => `${text} – lokal gespeichert ✓`,
  'submit.reject.implausibleTime': 'Global abgelehnt: Zeit als unmöglich eingestuft',
  'submit.reject.badCounters': 'Global abgelehnt: Tipp-/Fehlerzahl außerhalb des erlaubten Bereichs',
  'submit.reject.badSize': 'Global abgelehnt: Feldgröße nicht erlaubt',
  'submit.reject.badDifficulty': 'Global abgelehnt: Schwierigkeit nicht erlaubt',
  'submit.reject.rateLimited': 'Zu viele Einträge in kurzer Zeit – in einer Minute nochmal',
  'submit.reject.unknown': ({ reason }) => `Global abgelehnt („${reason}")`,
  'submit.reject.generic': 'Global abgelehnt',

  // ---------- settings ----------
  'settings.title': 'Einstellungen',
  'settings.size': 'Feldgröße',
  'settings.difficulty': 'Schwierigkeit',
  'settings.difficulty.hardOnly': 'Bei Feldgröße 12 sind nur schwere Rätsel möglich.',
  // "Anzeigesprache", not "Sprache": this label sits a few rows above
  // "Sprachsteuerung (Beta)", and two settings starting with "Sprach…" that mean
  // entirely different things read as one feature. English/French/Spanish have
  // no such collision ("Language" vs. "Voice control"), so only German qualifies.
  'settings.language.label': 'Anzeigesprache',
  'settings.language.auto': 'Automatisch (Browser)',
  'settings.language.hint':
    'Ein Sprachwechsel lädt das Spiel neu – eine laufende Partie geht dabei verloren.',
  'settings.language.confirm':
    'Sprache jetzt wechseln? Das Spiel wird neu geladen und die laufende Partie geht verloren.',
  'settings.quick.label': 'Schnellmodus',
  'settings.quick.hint':
    'Beim Setzen einer Dame werden Zeile, Spalte, Farbregion und angrenzende Felder automatisch gepunktet.',
  'settings.live.label': 'Live-Prüfung',
  'settings.live.hint':
    'Zeigt fortlaufend ein Statuslämpchen an, ob dein Spielstand fehlerfrei ist – ohne zu verraten, wo ein Fehler liegt. Erscheint erst kurz nach deinem letzten Zug. Ohne diese Option lässt sich der Status jederzeit über „Prüfen“ abrufen.',
  'settings.intro.label': 'Start-Animation',
  'settings.intro.hint':
    'Beim Erzeugen eines Rätsels breiten sich die Farbregionen animiert aus, während sich das Feld dreht – füllt die Wartezeit bei großen Feldern.',
  'settings.sound.label': 'Ton',
  'settings.sound.hint':
    'Kurze, dezente Soundeffekte beim Setzen einer Dame, Punkten, für Hinweise und beim Lösen. Lässt sich auch direkt oben über das Lautsprecher-Symbol stummschalten.',
  'settings.voice.label': 'Sprachsteuerung (Beta)',
  'settings.voice.hint':
    'Steuere das Spiel mit der Stimme (Chrome/Edge, Mikrofon nötig). Alle Sprachbefehle erklärt das ⓘ im Sprach-Panel.',
  'settings.voice.unsupported': ' Hinweis: In diesem Browser nicht verfügbar.',
  'settings.voice.germanOnly':
    ' Die Sprachbefehle gibt es vorerst nur auf Deutsch – dafür muss die Sprache auf Deutsch stehen.',
  'settings.voiceEdge.label': 'Koordinaten groß am Rand',
  'settings.voiceEdge.hint':
    'Zeigt die Spalten-Buchstaben und Zeilen-Zahlen groß am Rand des Feldes an – wie beim Schachbrett – statt klein in der Ecke jedes Feldes.',
  'settings.debug.label': 'Debug-Modus',
  'settings.debug.hint':
    'Zeigt einen Button, der alle Infos zum aktuellen Spielstand (inkl. Hinweis) in die Zwischenablage kopiert – hilfreich beim Melden von Problemen.',
  'settings.debugExt.label': 'Erweiterter Debug-Modus',
  'settings.debugExt.hint':
    'Zeichnet die letzten 10 Züge auf (inkl. Sprachbefehl-Transkript) und was „Rückgängig" jeweils entfernt hat. Dieses Protokoll wird beim „Debug kopieren" mit rauskopiert – hilfreich beim Melden von Sprachmodus-Fehlern.',
  'settings.note': 'Änderungen an Größe oder Schwierigkeit gelten für das nächste neue Spiel.',
  'settings.apply': 'Übernehmen & neues Spiel',
  'settings.close': 'Schließen',

  // ---------- share / QR dialog ----------
  'qr.button': 'Spiel per QR-Code teilen',
  'qr.title': 'Spiel teilen',
  'qr.hint':
    'Handy-Kamera auf den Code halten – das Spiel öffnet sich direkt im Browser, ganz ohne Installation.',
  'qr.alt': 'QR-Code mit der Web-Adresse des Spiels',

  // ---------- leaderboard modal ----------
  'lb.title': '🏆 Bestenliste',

  // ---------- hint card chrome ----------
  'hintcard.apply': 'Übernehmen',
  'hintcard.close': 'Schließen',
  'legend.reason': 'Begründung',
  'legend.target': 'hier setzen',
  'legend.x': 'scheidet aus',

  // ---------- debug ----------
  'debug.copied': '✓ Kopiert',
  'debug.copyFailed': 'Kopieren fehlgeschlagen',
  'debug.copiedSuffix': ' (Debug kopiert 📋)',

  // ---------- party mode ----------
  'party.kicker': 'Achievement freigeschaltet',
  'party.title': 'Partymodus',
  'party.text':
    'Du hast tatsächlich <strong>jedes einzelne Feld</strong> ausgepunktet – keine einzige Dame weit und breit. Absolutes Chaos. Wir sind zutiefst beeindruckt. 🎉',
  'party.close': 'Party beenden',

  // ---------- hints (js/hint.js) ----------
  // Unit words are separate keys because several hint sentences name a unit; the
  // sentences themselves are still whole per language, never assembled from
  // fragments.
  'hint.unit.region': 'Farbregion',
  'hint.unit.row': 'Zeile',
  'hint.unit.col': 'Spalte',

  'hint.apply.placeQueen': 'Dame setzen',
  'hint.apply.markCell': 'Feld markieren',
  'hint.apply.markCells': 'Felder markieren',
  'hint.apply.removeQueen': 'Dame entfernen',
  'hint.apply.removeMark': 'Markierung entfernen',

  'hint.place.title': ({ unit }) => `Nur ein Feld in der ${unit}`,
  'hint.place.text': ({ unit }) =>
    `In dieser ${unit} ist nur noch dieses eine Feld frei – alle anderen sind ausgeschlossen. Hier muss die Dame stehen.`,

  'hint.confine.colorRow.title': 'Farbe legt die Zeile fest',
  'hint.confine.colorRow.text':
    'Alle möglichen Felder dieser Farbe liegen in einer Zeile. Die Dame dieser Zeile gehört also zu dieser Farbe – die übrigen Felder der Zeile scheiden aus.',
  'hint.confine.colorCol.title': 'Farbe legt die Spalte fest',
  'hint.confine.colorCol.text':
    'Alle möglichen Felder dieser Farbe liegen in einer Spalte. Die Dame dieser Spalte gehört also zu dieser Farbe – die übrigen Felder der Spalte scheiden aus.',
  'hint.confine.rowColor.title': 'Zeile legt die Farbe fest',
  'hint.confine.rowColor.text':
    'In dieser Zeile sind nur noch Felder einer einzigen Farbe möglich. Die Dame dieser Farbe liegt also in dieser Zeile – ihre Felder in anderen Zeilen scheiden aus.',
  'hint.confine.colColor.title': 'Spalte legt die Farbe fest',
  'hint.confine.colColor.text':
    'In dieser Spalte sind nur noch Felder einer einzigen Farbe möglich. Die Dame dieser Farbe liegt also in dieser Spalte – ihre Felder in anderen Spalten scheiden aus.',

  'hint.deadEnd.title': ({ unit }) => `Würde eine ${unit} blockieren`,
  'hint.deadEnd.text': ({ unit, many }) =>
    `Eine Dame auf ${many ? 'einem dieser Felder' : 'diesem Feld'} würde jedes noch freie Feld dieser ${unit} ausschließen (gleiche Zeile, Spalte, Farbe oder direkt daneben). Da die ${unit} aber eine Dame braucht, ${many ? 'scheiden diese Felder aus' : 'scheidet dieses Feld aus'}.`,

  'hint.crowd.rowsRegions.title': ({ k }) => `${k} Farben passen nur in ${k} Zeilen`,
  'hint.crowd.rowsRegions.text': ({ k }) =>
    `In den ${k} hervorgehobenen Zeilen kommen nur ${k} Farben vor. Diese ${k} Farben müssen also in genau diese Zeilen – dieselben Farben scheiden in allen anderen Zeilen aus (schraffiert).`,
  'hint.crowd.colsRegions.title': ({ k }) => `${k} Farben passen nur in ${k} Spalten`,
  'hint.crowd.colsRegions.text': ({ k }) =>
    `In den ${k} hervorgehobenen Spalten kommen nur ${k} Farben vor. Diese ${k} Farben müssen also in genau diese Spalten – dieselben Farben scheiden in allen anderen Spalten aus (schraffiert).`,
  'hint.crowd.regionsRows.title': ({ k }) => `${k} Farben belegen ${k} Zeilen`,
  'hint.crowd.regionsRows.text': ({ k }) =>
    `Die ${k} hervorgehobenen Farben passen nur in ${k} Zeilen. Diese Zeilen gehören also diesen Farben – andere Farben scheiden in diesen Zeilen aus (schraffiert).`,
  'hint.crowd.regionsCols.title': ({ k }) => `${k} Farben belegen ${k} Spalten`,
  'hint.crowd.regionsCols.text': ({ k }) =>
    `Die ${k} hervorgehobenen Farben passen nur in ${k} Spalten. Diese Spalten gehören also diesen Farben – andere Farben scheiden in diesen Spalten aus (schraffiert).`,

  'hint.mistake.queen.title': 'Diese Dame passt nicht',
  'hint.mistake.queen.text':
    'Diese Dame kann nicht Teil der Lösung sein. Nimm sie zurück und probiere es an einer anderen Stelle.',
  'hint.markedSolution.place.title': 'Hier muss die Dame stehen',
  'hint.markedSolution.place.text': ({ unit }) =>
    `Dieses Feld ist als Ausschluss markiert – dabei ist es das einzige noch freie Feld seiner ${unit}. Entferne die Markierung und setze hier die Dame.`,
  'hint.markedSolution.mistake.title': 'Hier muss eine Dame stehen',
  'hint.markedSolution.mistake.text':
    'Dieses Feld ist als Ausschluss markiert, obwohl hier eine Dame stehen muss. Entferne die Markierung.',

  'hint.solved.title': 'Alles gelöst',
  'hint.solved.text': 'Alle Damen stehen richtig – gut gemacht!',
  'hint.reveal.title': 'Nächste Dame',
  'hint.reveal.text': 'Hier gehört die nächste Dame hin.',
  'hint.none.title': 'Kein Hinweis',
  'hint.none.text': 'Gerade ist kein einfacher Hinweis verfügbar.',
};
