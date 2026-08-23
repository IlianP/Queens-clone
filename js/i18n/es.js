// i18n/es.js — Spanish language pack.
//
// See js/i18n.js for the contract and js/i18n/de.js for the conventions all
// packs share: identical key sets, values are strings or functions of one
// params object, emoji stay untranslated.
//
// Terminology is pinned to the Spanish name of the underlying puzzle — the
// "problema de las ocho reinas" — so the piece is a **reina**, not a "dama"
// (both are valid chess terms; the puzzle's own name settles it). The board
// vocabulary follows: `casilla` (cell), `fila`, `columna`, `región de color`.
// All three unit words are feminine, which is why the sentences that
// interpolate one can say "la ${unit}" / "una ${unit}" without the pack having
// to carry a gender.
//
// Register is informal "tú" throughout, matching en/de/fr.
//
// Bundle constraint (this file is concatenated into the classic-script Artifact
// bundle): no `import.meta`, and no top-level name collisions — hence the
// es-prefixed helper names.

// Spanish plural: only 1 is singular ("0 pistas", "1 pista", "2 pistas").
const esPlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// 1.º, 2.º, 3.º … the masculine ordinal indicator, for "tu 2.º mejor tiempo".
const esOrdinal = (n) => `${n}.º`;
// Spanish writes "88 %" WITH a space (RAE) — a non-breaking one, so the sign
// never wraps to its own line. Intl/CLDR owns that rule; see js/i18n/en.js for
// why this helper is per-pack rather than shared.
const esLocale = 'es-ES';
const esPercent = (n) =>
  new Intl.NumberFormat(esLocale, { style: 'percent', maximumFractionDigits: 0 }).format(Number(n) / 100);

// Age of a leaderboard entry ("vor 3 Tagen") and its exact date. Intl owns both
// wordings: relative time has its own irregulars per language ("gestern", not
// "vor 1 Tag"), and a date format is a locale convention, not a translation.
// `numeric: 'auto'` is what buys those irregulars; 'short' keeps a row narrow.
const esRelTime = new Intl.RelativeTimeFormat(esLocale, { numeric: 'auto', style: 'short' });
const esDateTime = new Intl.DateTimeFormat(esLocale, { dateStyle: 'medium', timeStyle: 'short' });

export const I18N_ES = {
  // ---------- meta ----------
  'lang.htmlLang': 'es',

  // ---------- top bar / actions ----------
  'ui.newGame': 'Partida nueva',
  'ui.leaderboard': 'Clasificación',
  'ui.settings': 'Ajustes',
  'ui.board': 'Tablero de juego',
  'ui.check': '🔎 Comprobar',
  'ui.hint': '💡 Pista',
  'ui.undo': '↶ Deshacer',
  'ui.reset': '🔄 Reiniciar',
  'ui.debugCopy': '🐞 Copiar depuración',
  'ui.sound.mute': 'Silenciar el sonido',
  'ui.sound.unmute': 'Activar el sonido',
  'ui.sound.on': 'Sonido activado',
  'ui.sound.off': 'Sonido silenciado',
  'ui.footerHint':
    'Un toque por casilla: vacía → punto → 👑 → vacía. Una reina por fila, columna y color, y ninguna puede tocar a otra.',

  // ---------- board messages ----------
  'msg.almost': '¡Casi! Todavía hay conflictos.',
  'check.errors': '✗ Hay errores',
  'check.ok': '✓ Sin errores',

  // ---------- difficulty ----------
  'difficulty.easy': 'Fácil',
  'difficulty.medium': 'Media',
  'difficulty.hard': 'Difícil',
  'bucket.label': ({ size, difficulty }) => `${size}×${size} · ${difficulty}`,

  // ---------- durations ----------
  'time.seconds': ({ seconds }) => `${seconds} s`,
  'time.minutes': ({ time }) => `${time} min`,

  // ---------- score lists ----------
  'score.empty': 'Aún no hay entradas: ¡estrena tú la clasificación!',
  'score.anonymous': 'Anónimo',
  'score.you': 'Tú',
  // `unit` arrives as an Intl unit kind ('day', 'month', …), never as a word —
  // the fallback only catches a caller passing something else entirely.
  'score.age': ({ value, unit }) => esRelTime.format(-value, typeof unit === 'string' ? unit : 'day'),
  'score.rowDate': ({ at }) => `Registrado: ${esDateTime.format(new Date(at))}`,
  'score.rowTitle': ({ time, hints, mistakes }) =>
    `Tiempo ${time} · ${esPlural(hints, 'pista', 'pistas')} · ${esPlural(mistakes, 'error', 'errores')}`,

  // ---------- win card ----------
  'win.title': '🎉 ¡Resuelto!',
  'win.tab.local': 'Local',
  'win.tab.global': 'Global 🌐',
  'win.tab.period': ({ days }) => `${days} días`,
  'win.tab.periodAria': ({ days }) => `Clasificación de los últimos ${days} días`,
  'win.nickname.placeholder': 'Tu nombre',
  'win.nickname.aria': 'Tu nombre para la clasificación',
  'win.submit': 'Publicar',
  'win.save': 'Guardar',
  'win.retry': 'Reintentar',
  'win.newGame': 'Partida nueva',
  'win.settings': '⚙ Ajustes',
  'win.debugCopy': '📋 Copiar estado de depuración',
  'win.breakdown': ({ time, hints, mistakes }) =>
    `Tiempo ${time} · ${esPlural(hints, 'pista', 'pistas')} · ${esPlural(mistakes, 'error', 'errores')}`,

  // Relative feedback on the fresh solve (personal, offline, before any submit).
  'win.personal.first': ({ bucket }) =>
    `Tu primera partida en ${bucket}: a partir de ahora hay una marca que batir.`,
  'win.personal.best': '🏆 ¡Nuevo récord!',
  'win.personal.bestDetail': ({ delta, bucket }) => `${delta} mejor que tu récord anterior · ${bucket}`,
  'win.personal.rank': ({ rank, total }) => `Tu ${esOrdinal(rank)} mejor tiempo de ${total} partidas`,
  'win.personal.percentile': ({ percent, total, capped }) =>
    `Mejor que el ${esPercent(percent)} de tus ${capped ? `${total} últimas partidas` : `${total} partidas`}`,
  'win.personal.detail': ({ bucket, toBest }) => `${bucket} · ${toBest}`,
  'win.personal.detailRank': ({ rank, total, bucket, toBest }) =>
    `Puesto ${rank} de ${total} · ${bucket} · ${toBest}`,
  // The same comparison over a rolling window: how the solve stacks up against
  // current form, not against a record that may be a year old.
  'win.personal.recentBest': ({ days }) => `🔥 Tu mejor tiempo en ${days} días`,
  'win.personal.recentPercentile': ({ percent, total, days }) =>
    `Últimos ${days} días: mejor que el ${esPercent(percent)} de ${esPlural(total, 'partida', 'partidas')}`,
  'win.personal.recentRank': ({ rank, total, days }) =>
    `Últimos ${days} días: puesto ${rank} de ${total}`,
  'win.personal.toBest.equal': 'igualas tu mejor tiempo',
  'win.personal.toBest.delta': ({ delta }) => `+${delta} respecto a tu mejor tiempo`,

  // ---------- global leaderboard ----------
  'global.loading': 'Cargando la clasificación global …',
  'global.unreachable': 'No se puede acceder a la clasificación global.',
  'global.notSubmitted': 'Aún sin publicar: «Publicar» te añade aquí.',
  'submit.savedLocal': 'Guardado en local ✓',
  'submit.sending': 'Enviando a la clasificación global …',
  'submit.retrying': ({ attempt, total }) => `Reintentando … (${attempt}/${total})`,
  'submit.done': ({ rank, total }) => `Publicado: puesto ${rank} de ${total} 🌐`,
  'submit.donePercentile': ({ rank, total, percent }) =>
    `Publicado: puesto ${rank} de ${total}, mejor que el ${esPercent(percent)} de las entradas 🌐`,
  'submit.unreachable': 'Clasificación global inaccesible: guardado en local ✓. ¿Reintentar?',
  'submit.rejectedSaved': ({ text }) => `${text}: guardado en local ✓`,
  'submit.reject.implausibleTime': 'Rechazado en la global: el tiempo se considera imposible',
  'submit.reject.badCounters':
    'Rechazado en la global: el número de pistas o errores está fuera del rango permitido',
  'submit.reject.badSize': 'Rechazado en la global: tamaño de tablero no permitido',
  'submit.reject.badDifficulty': 'Rechazado en la global: dificultad no permitida',
  'submit.reject.rateLimited': 'Demasiadas entradas en poco tiempo: inténtalo de nuevo en un minuto',
  'submit.reject.unknown': ({ reason }) => `Rechazado en la global («${reason}»)`,
  'submit.reject.generic': 'Rechazado en la global',

  // ---------- settings ----------
  'settings.title': 'Ajustes',
  'settings.size': 'Tamaño del tablero',
  'settings.difficulty': 'Dificultad',
  'settings.difficulty.hardOnly': 'Con tamaño 12 solo son posibles los tableros difíciles.',
  'settings.language.label': 'Idioma',
  'settings.language.auto': 'Automático (navegador)',
  'settings.language.hint':
    'Cambiar de idioma recarga el juego: se pierde la partida en curso.',
  'settings.language.confirm':
    '¿Cambiar de idioma ahora? El juego se recarga y se pierde la partida en curso.',
  'settings.quick.label': 'Modo rápido',
  'settings.quick.hint':
    'Al colocar una reina se marcan automáticamente con un punto su fila, su columna, su región de color y las casillas contiguas.',
  'settings.live.label': 'Comprobación en directo',
  'settings.live.hint':
    'Muestra de forma continua un indicador de si tu tablero sigue sin errores, sin revelar dónde está el error. Aparece poco después de tu última jugada. Sin esta opción, el estado se puede consultar en cualquier momento con «Comprobar».',
  'settings.intro.label': 'Animación de inicio',
  'settings.intro.hint':
    'Mientras se genera un tablero, las regiones de color se despliegan animadas mientras el tablero gira: así se llena la espera en los tableros grandes.',
  'settings.sound.label': 'Sonido',
  'settings.sound.hint':
    'Efectos de sonido breves y discretos al colocar una reina, marcar puntos, pedir pistas y resolver. También se pueden silenciar directamente con el icono del altavoz de arriba.',
  'settings.voice.label': 'Control por voz (beta)',
  'settings.voice.hint':
    'Maneja el juego con la voz (Chrome/Edge, se necesita micrófono). La ⓘ del panel de voz explica cada comando.',
  'settings.voice.unsupported': ' Nota: no disponible en este navegador.',
  'settings.voice.germanOnly':
    ' Por ahora los comandos de voz solo existen en alemán: cambia el idioma a Deutsch para usarlos.',
  'settings.voiceEdge.label': 'Coordenadas grandes en el borde',
  'settings.voiceEdge.hint':
    'Muestra las letras de columna y los números de fila en grande en el borde del tablero, como en un tablero de ajedrez, en lugar de en pequeño en la esquina de cada casilla.',
  'settings.debug.label': 'Modo de depuración',
  'settings.debug.hint':
    'Muestra un botón que copia al portapapeles toda la información del tablero actual (incluida la pista): útil para informar de un problema.',
  'settings.debugExt.label': 'Modo de depuración ampliado',
  'settings.debugExt.hint':
    'Registra las 10 últimas jugadas (incluida la transcripción de voz) y qué ha quitado cada «Deshacer». Este registro se incluye al «Copiar depuración»: útil para informar de problemas del modo de voz.',
  'settings.note': 'Los cambios de tamaño o dificultad se aplican a la siguiente partida.',
  'settings.apply': 'Aplicar y jugar',
  'settings.close': 'Cerrar',

  // ---------- share / QR dialog ----------
  'qr.button': 'Compartir el juego por código QR',
  'qr.title': 'Compartir el juego',
  'qr.hint':
    'Apunta la cámara del móvil al código: el juego se abre directamente en el navegador, sin instalar nada.',
  'qr.alt': 'Código QR con la dirección web del juego',

  // ---------- leaderboard modal ----------
  'lb.title': '🏆 Clasificación',

  // ---------- hint card chrome ----------
  'hintcard.apply': 'Aplicar',
  'hintcard.close': 'Cerrar',
  'legend.reason': 'motivo',
  'legend.target': 'colocar aquí',
  'legend.x': 'descartada',

  // ---------- debug ----------
  'debug.copied': '✓ Copiado',
  'debug.copyFailed': 'No se pudo copiar',
  'debug.copiedSuffix': ' (depuración copiada 📋)',

  // ---------- party mode ----------
  'party.kicker': 'Logro desbloqueado',
  'party.title': 'Modo fiesta',
  'party.text':
    'Has marcado de verdad <strong>todas y cada una de las casillas</strong>: ni una sola reina a la vista. Caos absoluto. Estamos profundamente impresionados. 🎉',
  'party.close': 'Terminar la fiesta',

  // ---------- hints (js/hint.js) ----------
  // Unit words are separate keys because several hint sentences name a unit; the
  // sentences themselves are still whole per language, never assembled from
  // fragments. All three are feminine — see the header note.
  'hint.unit.region': 'región de color',
  'hint.unit.row': 'fila',
  'hint.unit.col': 'columna',

  'hint.apply.placeQueen': 'Colocar la reina',
  'hint.apply.markCell': 'Marcar la casilla',
  'hint.apply.markCells': 'Marcar las casillas',
  'hint.apply.removeQueen': 'Quitar la reina',
  'hint.apply.removeMark': 'Quitar la marca',

  'hint.place.title': ({ unit }) => `Solo queda una casilla en la ${unit}`,
  'hint.place.text': ({ unit }) =>
    `Es la única casilla que sigue libre en esa ${unit}: todas las demás están descartadas. La reina tiene que ir aquí.`,

  'hint.confine.colorRow.title': 'El color fija la fila',
  'hint.confine.colorRow.text':
    'Todas las casillas posibles de este color están en una misma fila. Por tanto, la reina de esa fila pertenece a este color y las demás casillas de la fila quedan descartadas.',
  'hint.confine.colorCol.title': 'El color fija la columna',
  'hint.confine.colorCol.text':
    'Todas las casillas posibles de este color están en una misma columna. Por tanto, la reina de esa columna pertenece a este color y las demás casillas de la columna quedan descartadas.',
  'hint.confine.rowColor.title': 'La fila fija el color',
  'hint.confine.rowColor.text':
    'En esta fila solo siguen siendo posibles casillas de un único color. Por tanto, la reina de ese color está en esta fila y sus casillas en otras filas quedan descartadas.',
  'hint.confine.colColor.title': 'La columna fija el color',
  'hint.confine.colColor.text':
    'En esta columna solo siguen siendo posibles casillas de un único color. Por tanto, la reina de ese color está en esta columna y sus casillas en otras columnas quedan descartadas.',

  'hint.deadEnd.title': ({ unit }) => `Bloquearía una ${unit}`,
  'hint.deadEnd.text': ({ unit, many }) =>
    `Una reina en ${many ? 'cualquiera de estas casillas' : 'esta casilla'} descartaría todas las casillas que siguen libres en esa ${unit} (misma fila, misma columna, mismo color o casilla contigua). Pero como esa ${unit} necesita una reina, ${many ? 'estas casillas quedan descartadas' : 'esta casilla queda descartada'}.`,

  'hint.crowd.rowsRegions.title': ({ k }) => `${k} colores caben solo en ${k} filas`,
  'hint.crowd.rowsRegions.text': ({ k }) =>
    `En las ${k} filas resaltadas solo aparecen ${k} colores. Esos ${k} colores tienen que ir por tanto exactamente en estas filas, y quedan descartados en todas las demás filas (rayadas).`,
  'hint.crowd.colsRegions.title': ({ k }) => `${k} colores caben solo en ${k} columnas`,
  'hint.crowd.colsRegions.text': ({ k }) =>
    `En las ${k} columnas resaltadas solo aparecen ${k} colores. Esos ${k} colores tienen que ir por tanto exactamente en estas columnas, y quedan descartados en todas las demás columnas (rayadas).`,
  'hint.crowd.regionsRows.title': ({ k }) => `${k} colores ocupan ${k} filas`,
  'hint.crowd.regionsRows.text': ({ k }) =>
    `Los ${k} colores resaltados solo caben en ${k} filas. Esas filas pertenecen por tanto a estos colores, y los demás colores quedan descartados en ellas (rayadas).`,
  'hint.crowd.regionsCols.title': ({ k }) => `${k} colores ocupan ${k} columnas`,
  'hint.crowd.regionsCols.text': ({ k }) =>
    `Los ${k} colores resaltados solo caben en ${k} columnas. Esas columnas pertenecen por tanto a estos colores, y los demás colores quedan descartados en ellas (rayadas).`,

  'hint.mistake.queen.title': 'Esta reina no encaja',
  'hint.mistake.queen.text':
    'Esta reina no puede formar parte de la solución. Quítala y prueba en otro sitio.',
  'hint.markedSolution.place.title': 'La reina va aquí',
  'hint.markedSolution.place.text': ({ unit }) =>
    `Esta casilla está marcada con un punto como descartada, pero es la única casilla que sigue libre en su ${unit}. Quita el punto y coloca aquí la reina.`,
  'hint.markedSolution.mistake.title': 'Aquí va una reina',
  'hint.markedSolution.mistake.text':
    'Esta casilla está marcada con un punto como descartada aunque aquí tiene que ir una reina. Quita el punto.',

  'hint.solved.title': 'Todo resuelto',
  'hint.solved.text': 'Todas las reinas están bien colocadas. ¡Bien hecho!',
  'hint.reveal.title': 'Siguiente reina',
  'hint.reveal.text': 'La siguiente reina va aquí.',
  'hint.none.title': 'Sin pista',
  'hint.none.text': 'Ahora mismo no hay ninguna pista sencilla disponible.',
};
