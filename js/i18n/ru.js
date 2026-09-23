// i18n/ru.js — Russian language pack.
//
// See js/i18n.js for the contract and js/i18n/de.js for the conventions all
// packs share: identical key sets, values are strings or functions of one
// params object, emoji stay untranslated.
//
// This is the first pack that genuinely exercises the "a value is a FUNCTION,
// and plural rules live in the pack that needs them" design, in two ways that
// en/de/fr/es never hit. Both are solved inside this file; nothing in
// js/i18n.js, js/hint.js or any caller changed to accommodate them.
//
//   1. THREE plural forms, not two (see ruPlural).
//   2. Nouns DECLINE, so a unit word cannot simply be dropped into a sentence
//      (see ruUnit).
//
// Terminology is pinned to the Russian name of the underlying puzzle — the
// "задача о восьми ферзях" — so the piece is a **ферзь** (the chess term),
// not "королева". Board vocabulary: `клетка` (cell), `строка`, `колонка`,
// `цветная область`.
//
// Register is informal "ты" throughout, matching en/de/fr/es. Russian UIs more
// often use formal "вы"; "ты" is the deliberate choice here for a casual puzzle
// game and for consistency with the other packs.
//
// Bundle constraint (this file is concatenated into the classic-script Artifact
// bundle): no `import.meta`, and no top-level name collisions — hence the
// ru-prefixed helper names.

// Russian has THREE plural forms where en/de/fr/es have two, and the choice
// repeats modulo 100: 1/21/31 → one, 2–4/22–24 → few, 0/5–20/25–30 → many.
//   1 подсказка · 2 подсказки · 5 подсказок · 21 подсказка · 22 подсказки
// The rule is CLDR data, so Intl.PluralRules decides rather than a hand-rolled
// modulo chain — same reasoning as the percent and date helpers below, and no
// new dependency (this is why the project can add Russian without a build step).
const ruLocale = 'ru-RU';
const ruPluralRules = new Intl.PluralRules(ruLocale);
const ruPlural = (n, one, few, many) => {
  const form = ruPluralRules.select(n);
  return `${n} ${form === 'one' ? one : form === 'few' ? few : many}`;
};
// Ordinals agree with their noun's gender. The only ordinal in the UI qualifies
// "время" (neuter), and the neuter ending is a uniform "-е" — 1-е, 2-е, 3-е —
// with none of the irregulars the masculine "-й" form carries (3-й, but 2-й).
const ruOrdinal = (n) => `${n}-е`;
// Russian writes "88 %" WITH a space, like de/fr/es and unlike en/pt — and a
// non-breaking one, so the sign never wraps onto a line of its own. Intl/CLDR
// owns that; see js/i18n/en.js for why the helper is per-pack rather than shared.
const ruPercent = (n) =>
  new Intl.NumberFormat(ruLocale, { style: 'percent', maximumFractionDigits: 0 }).format(Number(n) / 100);

// Age of a leaderboard entry ("3 дн. назад") and its exact date. Intl owns both
// wordings: relative time has its own irregulars per language ("вчера", not
// "1 день назад"), and a date format is a locale convention, not a translation.
const ruRelTime = new Intl.RelativeTimeFormat(ruLocale, { numeric: 'auto', style: 'short' });
const ruDateTime = new Intl.DateTimeFormat(ruLocale, { dateStyle: 'medium', timeStyle: 'short' });

// Russian nouns decline, and the hint sentences need a unit word in four
// different cases:
//
//   "только одна клетка в строкЕ"        (prepositional)
//   "заблокирует строкУ"                  (accusative)
//   "свободные клетки этой строкИ"        (genitive)
//   "раз этой строкЕ нужен ферзь"         (dative)
//
// `hint.js` passes the unit as an already-translated string, and the pack
// contract says that string is whatever `hint.unit.*` holds — the nominative.
// Interpolating it raw would produce "в этой строка". So this pack declines it
// back: the three unit kinds are a closed, known set, which makes an exact
// lookup honest where a suffix-stripping rule would be a guess. Keyed by the
// nominative so it stays in step with the `hint.unit.*` values below — change
// one and you must change the other.
//
// All three are feminine, which is why the sentences can say "этой ${…}"
// without also varying the pronoun. A fourth unit kind would fall through to
// the nominative: readable, slightly wrong, and never silently missing — add
// its row here at the same time.
const RU_UNIT_FORMS = {
  'строка': { gen: 'строки', dat: 'строке', acc: 'строку', prep: 'строке' },
  'колонка': { gen: 'колонки', dat: 'колонке', acc: 'колонку', prep: 'колонке' },
  'цветная область': {
    gen: 'цветной области',
    dat: 'цветной области',
    acc: 'цветную область',
    prep: 'цветной области',
  },
};
const ruUnit = (unit, form) => (RU_UNIT_FORMS[unit] && RU_UNIT_FORMS[unit][form]) || unit;

export const I18N_RU = {
  // ---------- meta ----------
  'lang.htmlLang': 'ru',

  // ---------- top bar / actions ----------
  'ui.newGame': 'Новая игра',
  'ui.leaderboard': 'Таблица лидеров',
  'ui.settings': 'Настройки',
  'ui.board': 'Игровое поле',
  'ui.check': '🔎 Проверить',
  'ui.hint': '💡 Подсказка',
  // The price tag on the hint button (bracketed, it trails a label) and the
  // pill that flies off it when a hint is actually charged (bare, it stands
  // alone). Two presentations, one number — both are handed HINT_PENALTY, so
  // the label, the animation and the score cannot quote different figures.
  'ui.hint.cost': ({ seconds }) => `+${seconds} с`,
  'ui.hint.costLabel': ({ seconds }) => `(+${seconds} с)`,
  'ui.hint.title': ({ seconds }) =>
    `Новая подсказка добавляет ${ruPlural(seconds, 'секунду', 'секунды', 'секунд')} к твоему времени. Открыть ту же подсказку ещё раз — бесплатно.`,
  'ui.undo': '↶ Отменить',
  'ui.reset': '🔄 Сбросить',
  'ui.debugCopy': '🐞 Копировать отладку',
  'ui.sound.mute': 'Выключить звук',
  'ui.sound.unmute': 'Включить звук',
  'ui.sound.on': 'Звук включён',
  'ui.sound.off': 'Звук выключен',
  'ui.footerHint':
    'Одно касание на клетку: пусто → точка → 👑 → пусто. По одному ферзю в каждой строке, колонке и цвете — и никакие два не должны соприкасаться.',

  // ---------- board messages ----------
  'msg.almost': 'Почти! Конфликты ещё остались.',
  'check.errors': '✗ Есть ошибки',
  'check.ok': '✓ Ошибок нет',

  // ---------- difficulty ----------
  'difficulty.easy': 'Легко',
  'difficulty.medium': 'Средне',
  'difficulty.hard': 'Сложно',
  'bucket.label': ({ size, difficulty }) => `${size}×${size} · ${difficulty}`,

  // ---------- durations ----------
  'time.seconds': ({ seconds }) => `${seconds} с`,
  'time.minutes': ({ time }) => `${time} мин`,

  // ---------- score lists ----------
  'score.empty': 'Записей пока нет — стань первым!',
  // «Не больше» takes the genitive: одной записи, трёх/семнадцати записей.
  'score.capNote': ({ perPlayer, hidden }) =>
    `Не больше ${ruPlural(perPlayer, 'записи', 'записей', 'записей')} на игрока · скрыто ещё ${hidden}`,
  'score.anonymous': 'Аноним',
  'score.you': 'Ты',
  // `unit` arrives as an Intl unit kind ('day', 'month', …), never as a word —
  // the fallback only catches a caller passing something else entirely.
  'score.age': ({ value, unit }) => ruRelTime.format(-value, typeof unit === 'string' ? unit : 'day'),
  'score.rowDate': ({ at }) => `Отправлено: ${ruDateTime.format(new Date(at))}`,
  'score.rowTitle': ({ time, hints, mistakes, penalty }) =>
    `Игровое время ${time} · ${ruPlural(hints, 'подсказка', 'подсказки', 'подсказок')}${hints ? ` (+${penalty})` : ''} · ${ruPlural(mistakes, 'ошибка', 'ошибки', 'ошибок')}`,

  // ---------- win card ----------
  'win.title': '🎉 Решено!',
  'win.viewBoard': 'Посмотреть решённое поле',
  // Three tabs plus an emoji is the tightest label row in the app and the tab
  // boxes are a fixed three-across grid, so Russian needs terser words than
  // "Локально"/"Глобально 🌐", which overflowed at 95px. Both are adjectives
  // agreeing with the implied "таблица": my list vs the shared one.
  'win.tab.local': 'Мои',
  'win.tab.localAria': 'Таблица лидеров на этом устройстве',
  'win.tab.global': 'Общая 🌐',
  'win.tab.period': ({ days }) => ruPlural(days, 'день', 'дня', 'дней'),
  'win.tab.periodAria': ({ days }) =>
    `Таблица лидеров за последние ${ruPlural(days, 'день', 'дня', 'дней')}`,
  'win.nickname.placeholder': 'Твоё имя',
  'win.nickname.aria': 'Твоё имя для таблицы лидеров',
  'win.submit': 'Отправить',
  'win.save': 'Сохранить',
  'win.retry': 'Повторить',
  'win.newGame': 'Новая игра',
  'win.settings': '⚙ Настройки',
  'win.debugCopy': '📋 Копировать состояние отладки',
  'win.breakdown': ({ time, hints, mistakes, penalty }) =>
    `Игровое время ${time} · ${ruPlural(hints, 'подсказка', 'подсказки', 'подсказок')}${hints ? ` (+${penalty})` : ''} · ${ruPlural(mistakes, 'ошибка', 'ошибки', 'ошибок')}`,

  // Relative feedback on the fresh solve (personal, offline, before any submit).
  // "из ${total} партий": after "из" the noun is genitive plural whatever the
  // number, so this one needs no plural helper.
  'win.personal.first': ({ bucket }) =>
    `Твоя первая партия на ${bucket} — теперь есть результат, который можно побить.`,
  'win.personal.best': '🏆 Новый рекорд!',
  'win.personal.bestDetail': ({ delta, bucket }) => `На ${delta} быстрее прежнего рекорда · ${bucket}`,
  'win.personal.rank': ({ rank, total }) =>
    `Твоё ${ruOrdinal(rank)} лучшее время из ${total} партий`,
  'win.personal.percentile': ({ percent, total, capped }) =>
    `Лучше, чем ${ruPercent(percent)} ${capped ? `твоих последних ${total} партий` : `твоих ${total} партий`}`,
  'win.personal.detail': ({ bucket, toBest }) => `${bucket} · ${toBest}`,
  'win.personal.detailRank': ({ rank, total, bucket, toBest }) =>
    `Место ${rank} из ${total} · ${bucket} · ${toBest}`,
  // The same comparison over a rolling window: how the solve stacks up against
  // current form, not against a record that may be a year old.
  'win.personal.recentBest': ({ days }) =>
    `🔥 Твоё лучшее время за ${ruPlural(days, 'день', 'дня', 'дней')}`,
  'win.personal.recentPercentile': ({ percent, total, days }) =>
    `За последние ${ruPlural(days, 'день', 'дня', 'дней')}: лучше, чем ${ruPercent(percent)} из ${total} партий`,
  'win.personal.recentRank': ({ rank, total, days }) =>
    `За последние ${ruPlural(days, 'день', 'дня', 'дней')}: место ${rank} из ${total}`,
  'win.personal.toBest.equal': 'наравне с твоим лучшим временем',
  'win.personal.toBest.delta': ({ delta }) => `+${delta} к лучшему времени`,

  // ---------- global leaderboard ----------
  'global.loading': 'Загрузка таблицы лидеров …',
  'global.unreachable': 'Таблица лидеров недоступна.',
  'global.notSubmitted': 'Ещё не отправлено — «Отправить» добавит тебя сюда.',
  'submit.savedLocal': 'Сохранено локально ✓',
  'submit.sending': 'Отправка в таблицу лидеров …',
  'submit.retrying': ({ attempt, total }) => `Повторная попытка … (${attempt}/${total})`,
  'submit.done': ({ rank, total }) => `Отправлено: место ${rank} из ${total} 🌐`,
  'submit.donePercentile': ({ rank, total, percent }) =>
    `Отправлено: место ${rank} из ${total} — лучше, чем ${ruPercent(percent)} всех записей 🌐`,
  'submit.donePlayers': ({ rank, total }) =>
    `Отправлено: место ${rank} из ${ruPlural(total, 'игрока', 'игроков', 'игроков')} 🌐`,
  'submit.donePlayersPercentile': ({ rank, total, percent }) =>
    `Отправлено: место ${rank} из ${ruPlural(total, 'игрока', 'игроков', 'игроков')} — лучше, чем ${ruPercent(percent)} из них 🌐`,
  'submit.donePlayersNotBest': ({ rank, total }) =>
    `Отправлено 🌐 Не личный рекорд — твой лучший результат держит место ${rank} из ${ruPlural(total, 'игрока', 'игроков', 'игроков')}.`,
  'submit.unreachable': 'Таблица лидеров недоступна — сохранено локально ✓. Повторить?',
  'submit.rejectedSaved': ({ text }) => `${text} — сохранено локально ✓`,
  'submit.reject.implausibleTime': 'Отклонено сервером: время признано невозможным',
  'submit.reject.badCounters':
    'Отклонено сервером: число подсказок или ошибок вне допустимого диапазона',
  'submit.reject.badSize': 'Отклонено сервером: такой размер поля не разрешён',
  'submit.reject.badDifficulty': 'Отклонено сервером: такая сложность не разрешена',
  'submit.reject.rateLimited': 'Слишком много записей за короткое время — попробуй через минуту',
  'submit.reject.unknown': ({ reason }) => `Отклонено сервером («${reason}»)`,
  'submit.reject.generic': 'Отклонено сервером',

  // ---------- settings ----------
  'settings.title': 'Настройки',
  'settings.size': 'Размер поля',
  'settings.difficulty': 'Сложность',
  'settings.difficulty.hardOnly': 'При размере поля от 12 возможны только сложные головоломки.',
  'settings.size.tight': ({ px }) =>
    `На этом экране клетка будет всего около ${px} px — на устройстве побольше играть удобнее.`,
  'settings.language.label': 'Язык',
  'settings.language.auto': 'Автоматически (браузер)',
  'settings.language.hint':
    'Смена языка перезагружает игру — текущая партия будет потеряна.',
  'settings.language.confirm':
    'Сменить язык сейчас? Игра перезагрузится, и текущая партия будет потеряна.',
  'settings.quick.label': 'Быстрый режим',
  'settings.quick.hint':
    'При постановке ферзя его строка, колонка, цветная область и соседние клетки отмечаются точками автоматически.',
  'settings.live.label': 'Проверка на лету',
  'settings.live.hint':
    'Постоянно показывает индикатор того, остаётся ли поле без ошибок — не раскрывая, где именно ошибка. Появляется вскоре после твоего последнего хода. Без этой опции статус можно посмотреть в любой момент через «Проверить».',
  'settings.intro.label': 'Вступительная анимация',
  'settings.intro.hint':
    'Пока создаётся головоломка, цветные области растекаются по вращающемуся полю — это скрашивает ожидание на больших полях.',
  'settings.sound.label': 'Звук',
  'settings.sound.hint':
    'Короткие ненавязчивые звуки при постановке ферзя, отметке точками, подсказках и решении. Их также можно выключить прямо значком динамика сверху.',
  'settings.voice.label': 'Голосовое управление (бета)',
  'settings.voice.hint':
    'Управляй игрой голосом (Chrome/Edge, нужен микрофон). Значок ⓘ в голосовой панели объясняет каждую команду.',
  'settings.voice.unsupported': ' Примечание: в этом браузере недоступно.',
  'settings.voice.germanOnly':
    ' Голосовые команды пока есть только на немецком — переключи язык на Deutsch, чтобы ими пользоваться.',
  'settings.voiceEdge.label': 'Крупные координаты по краю',
  'settings.voiceEdge.hint':
    'Показывает буквы колонок и номера строк крупно по краю поля — как на шахматной доске — вместо мелких меток в углу каждой клетки.',
  'settings.debug.label': 'Режим отладки',
  'settings.debug.hint':
    'Показывает кнопку, которая копирует в буфер обмена всё о текущем поле (включая подсказку) — полезно при сообщении о проблеме.',
  'settings.debugExt.label': 'Расширенный режим отладки',
  'settings.debugExt.hint':
    'Записывает последние 10 ходов (включая расшифровку голоса) и то, что убрала каждая «Отмена». Этот журнал попадает в «Копировать отладку» — полезно при сообщении о проблемах голосового режима.',
  'settings.note': 'Изменения размера или сложности вступают в силу со следующей партии.',
  'settings.apply': 'Применить и начать',
  'settings.close': 'Закрыть',

  // ---------- share / QR dialog ----------
  'qr.button': 'Поделиться игрой и сведения о проекте',
  'qr.title': 'Поделиться игрой',
  'qr.hint':
    'Наведи камеру телефона на код — игра откроется прямо в браузере, ставить ничего не нужно.',
  'qr.alt': 'QR-код с веб-адресом игры',
  'qr.repoHint':
    'Интересно, как это устроено, или есть идея? Проект с открытым исходным кодом на GitHub — issues и pull requests приветствуются.',

  // ---------- leaderboard modal ----------
  'lb.title': '🏆 Таблица лидеров',

  // ---------- hint card chrome ----------
  'hintcard.apply': 'Применить',
  'hintcard.close': 'Закрыть',
  'legend.reason': 'обоснование',
  'legend.target': 'ставить сюда',
  'legend.x': 'исключено',

  // ---------- debug ----------
  'debug.copied': '✓ Скопировано',
  'debug.copyFailed': 'Не удалось скопировать',
  'debug.copiedSuffix': ' (отладка скопирована 📋)',

  // ---------- party mode ----------
  'party.kicker': 'Достижение разблокировано',
  'party.title': 'Режим вечеринки',
  'party.text':
    'Ты и правда отметил точками <strong>каждую клетку</strong> — и ни одного ферзя в округе. Абсолютный хаос. Мы глубоко впечатлены. 🎉',
  'party.close': 'Закончить вечеринку',

  // ---------- hints (js/hint.js) ----------
  // Unit words are separate keys because several hint sentences name a unit; the
  // sentences themselves are still whole per language, never assembled from
  // fragments. These are the NOMINATIVE forms — the sentences below decline them
  // through ruUnit(), and RU_UNIT_FORMS is keyed by exactly these strings.
  'hint.unit.region': 'цветная область',
  'hint.unit.row': 'строка',
  'hint.unit.col': 'колонка',

  'hint.apply.placeQueen': 'Поставить ферзя',
  'hint.apply.markCell': 'Отметить клетку',
  'hint.apply.markCells': 'Отметить клетки',
  'hint.apply.removeQueen': 'Убрать ферзя',
  'hint.apply.removeMark': 'Убрать отметку',

  'hint.place.title': ({ unit }) => `Только одна клетка в ${ruUnit(unit, 'prep')}`,
  'hint.place.text': ({ unit }) =>
    `Это единственная свободная клетка в этой ${ruUnit(unit, 'prep')} — все остальные исключены. Ферзь должен стоять здесь.`,

  'hint.confine.colorRow.title': 'Цвет задаёт строку',
  'hint.confine.colorRow.text':
    'Все возможные клетки этого цвета лежат в одной строке. Значит, ферзь этой строки принадлежит этому цвету — остальные клетки строки исключены.',
  'hint.confine.colorCol.title': 'Цвет задаёт колонку',
  'hint.confine.colorCol.text':
    'Все возможные клетки этого цвета лежат в одной колонке. Значит, ферзь этой колонки принадлежит этому цвету — остальные клетки колонки исключены.',
  'hint.confine.rowColor.title': 'Строка задаёт цвет',
  'hint.confine.rowColor.text':
    'В этой строке возможны только клетки одного-единственного цвета. Значит, ферзь этого цвета стоит в этой строке — его клетки в других строках исключены.',
  'hint.confine.colColor.title': 'Колонка задаёт цвет',
  'hint.confine.colColor.text':
    'В этой колонке возможны только клетки одного-единственного цвета. Значит, ферзь этого цвета стоит в этой колонке — его клетки в других колонках исключены.',

  'hint.deadEnd.title': ({ unit }) => `Заблокирует ${ruUnit(unit, 'acc')}`,
  'hint.deadEnd.text': ({ unit, many }) =>
    `Ферзь на ${many ? 'любой из этих клеток' : 'этой клетке'} исключил бы все ещё свободные клетки этой ${ruUnit(unit, 'gen')} (та же строка, та же колонка, тот же цвет или соседняя клетка). Но раз этой ${ruUnit(unit, 'dat')} нужен ферзь, ${many ? 'эти клетки исключены' : 'эта клетка исключена'}.`,

  'hint.crowd.rowsRegions.title': ({ k }) =>
    `${ruPlural(k, 'цвет', 'цвета', 'цветов')} помещаются только в ${ruPlural(k, 'строку', 'строки', 'строк')}`,
  'hint.crowd.rowsRegions.text': ({ k }) =>
    `В этих ${k} выделенных строках встречаются только ${ruPlural(k, 'цвет', 'цвета', 'цветов')}. Значит, эти цвета должны попасть именно в эти строки — те же цвета исключены во всех остальных строках (заштрихованы).`,
  'hint.crowd.colsRegions.title': ({ k }) =>
    `${ruPlural(k, 'цвет', 'цвета', 'цветов')} помещаются только в ${ruPlural(k, 'колонку', 'колонки', 'колонок')}`,
  'hint.crowd.colsRegions.text': ({ k }) =>
    `В этих ${k} выделенных колонках встречаются только ${ruPlural(k, 'цвет', 'цвета', 'цветов')}. Значит, эти цвета должны попасть именно в эти колонки — те же цвета исключены во всех остальных колонках (заштрихованы).`,
  'hint.crowd.regionsRows.title': ({ k }) =>
    `${ruPlural(k, 'цвет', 'цвета', 'цветов')} занимают ${ruPlural(k, 'строку', 'строки', 'строк')}`,
  'hint.crowd.regionsRows.text': ({ k }) =>
    `${ruPlural(k, 'выделенный цвет', 'выделенных цвета', 'выделенных цветов')} помещаются только в ${ruPlural(k, 'строку', 'строки', 'строк')}. Значит, эти строки принадлежат этим цветам — другие цвета в них исключены (заштрихованы).`,
  'hint.crowd.regionsCols.title': ({ k }) =>
    `${ruPlural(k, 'цвет', 'цвета', 'цветов')} занимают ${ruPlural(k, 'колонку', 'колонки', 'колонок')}`,
  'hint.crowd.regionsCols.text': ({ k }) =>
    `${ruPlural(k, 'выделенный цвет', 'выделенных цвета', 'выделенных цветов')} помещаются только в ${ruPlural(k, 'колонку', 'колонки', 'колонок')}. Значит, эти колонки принадлежат этим цветам — другие цвета в них исключены (заштрихованы).`,

  'hint.mistake.queen.title': 'Этот ферзь не подходит',
  'hint.mistake.queen.text':
    'Этот ферзь не может быть частью решения. Убери его и попробуй другое место.',
  'hint.markedSolution.place.title': 'Ферзь должен стоять здесь',
  'hint.markedSolution.place.text': ({ unit }) =>
    `Эта клетка отмечена точкой как исключённая — хотя это единственная свободная клетка в своей ${ruUnit(unit, 'prep')}. Убери точку и поставь сюда ферзя.`,
  'hint.markedSolution.mistake.title': 'Здесь должен стоять ферзь',
  'hint.markedSolution.mistake.text':
    'Эта клетка отмечена точкой как исключённая, хотя здесь должен стоять ферзь. Убери точку.',

  'hint.solved.title': 'Всё решено',
  'hint.solved.text': 'Все ферзи стоят правильно — отлично!',
  'hint.reveal.title': 'Следующий ферзь',
  'hint.reveal.text': 'Следующий ферзь должен стоять здесь.',
  'hint.none.title': 'Подсказки нет',
  'hint.none.text': 'Сейчас простой подсказки нет.',
};
