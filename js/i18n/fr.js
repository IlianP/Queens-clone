// i18n/fr.js — French language pack.
//
// See js/i18n.js for the contract and js/i18n/de.js for the conventions all
// packs share: identical key sets, values are strings or functions of one
// params object, emoji stay untranslated.
//
// Terminology is pinned to the French name of the underlying puzzle — the
// "problème des huit dames" — so the piece is a **dame**, never a "reine". The
// board vocabulary follows from that: `case` (cell), `ligne`, `colonne`,
// `région de couleur`. All three unit words are feminine, which is why the
// sentences that interpolate one can say "la ${unit}" / "une ${unit}" without
// the pack having to carry a gender.
//
// Typography: French puts a space before « : », « ! », « ? » and uses
// guillemets for quotes — that is not a stray space, don't "fix" it.
//
// Bundle constraint (this file is concatenated into the classic-script Artifact
// bundle): no `import.meta`, and no top-level name collisions — hence the
// fr-prefixed helper names.

// French plural: 0 AND 1 are singular ("0 indice", "2 indices") — this is the
// one place French differs from the en/de rule, so it is not a copy of enPlural.
const frPlural = (n, one, many) => `${n} ${n < 2 ? one : many}`;
// 1er, then "e" for everything after it: 2e, 3e, 4e …
const frOrdinal = (n) => (n === 1 ? '1er' : `${n}e`);
// French writes "88 %" with a space before the sign — a non-breaking one, so it
// never wraps to its own line. Which space exactly (NBSP vs. narrow NBSP) is a
// CLDR question that moves between ICU versions, so it is delegated to Intl
// instead of typed by hand; see js/i18n/en.js for why this helper is per-pack.
const frLocale = 'fr-FR';
const frPercent = (n) =>
  new Intl.NumberFormat(frLocale, { style: 'percent', maximumFractionDigits: 0 }).format(Number(n) / 100);

// Age of a leaderboard entry ("vor 3 Tagen") and its exact date. Intl owns both
// wordings: relative time has its own irregulars per language ("gestern", not
// "vor 1 Tag"), and a date format is a locale convention, not a translation.
// `numeric: 'auto'` is what buys those irregulars; 'short' keeps a row narrow.
const frRelTime = new Intl.RelativeTimeFormat(frLocale, { numeric: 'auto', style: 'short' });
const frDateTime = new Intl.DateTimeFormat(frLocale, { dateStyle: 'medium', timeStyle: 'short' });

export const I18N_FR = {
  // ---------- meta ----------
  'lang.htmlLang': 'fr',

  // ---------- top bar / actions ----------
  'ui.newGame': 'Nouvelle partie',
  'ui.leaderboard': 'Classement',
  'ui.settings': 'Réglages',
  'ui.board': 'Grille de jeu',
  'ui.check': '🔎 Vérifier',
  'ui.hint': '💡 Indice',
  'ui.undo': '↶ Annuler',
  'ui.reset': '🔄 Réinitialiser',
  'ui.debugCopy': '🐞 Copier le débogage',
  'ui.sound.mute': 'Couper le son',
  'ui.sound.unmute': 'Activer le son',
  'ui.sound.on': 'Son activé',
  'ui.sound.off': 'Son coupé',
  'ui.footerHint':
    'Un appui par case : vide → point → 👑 → vide. Une dame par ligne, colonne et couleur – et aucune ne doit en toucher une autre.',

  // ---------- board messages ----------
  'msg.almost': 'Presque ! Il reste des conflits.',
  'check.errors': '✗ Il y a des erreurs',
  'check.ok': '✓ Aucune erreur',

  // ---------- difficulty ----------
  'difficulty.easy': 'Facile',
  'difficulty.medium': 'Moyen',
  'difficulty.hard': 'Difficile',
  'bucket.label': ({ size, difficulty }) => `${size}×${size} · ${difficulty}`,

  // ---------- durations ----------
  'time.seconds': ({ seconds }) => `${seconds} s`,
  'time.minutes': ({ time }) => `${time} min`,

  // ---------- score lists ----------
  'score.empty': 'Aucune entrée pour le moment – à toi d’ouvrir le classement !',
  'score.anonymous': 'Anonyme',
  'score.you': 'Toi',
  // `unit` arrives as an Intl unit kind ('day', 'month', …), never as a word —
  // the fallback only catches a caller passing something else entirely.
  'score.age': ({ value, unit }) => frRelTime.format(-value, typeof unit === 'string' ? unit : 'day'),
  'score.rowDate': ({ at }) => `Enregistré : ${frDateTime.format(new Date(at))}`,
  'score.rowTitle': ({ time, hints, mistakes }) =>
    `Temps ${time} · ${frPlural(hints, 'indice', 'indices')} · ${frPlural(mistakes, 'erreur', 'erreurs')}`,

  // ---------- win card ----------
  'win.title': '🎉 Résolu !',
  'win.tab.local': 'Local',
  'win.tab.global': 'Global 🌐',
  'win.tab.period': ({ days }) => `${days} jours`,
  'win.tab.periodAria': ({ days }) => `Classement des ${days} derniers jours`,
  'win.nickname.placeholder': 'Ton nom',
  'win.nickname.aria': 'Ton nom pour le classement',
  'win.submit': 'Publier',
  'win.save': 'Enregistrer',
  'win.retry': 'Réessayer',
  'win.newGame': 'Nouvelle partie',
  'win.settings': '⚙ Réglages',
  'win.debugCopy': '📋 Copier l’état de débogage',
  'win.breakdown': ({ time, hints, mistakes }) =>
    `Temps ${time} · ${frPlural(hints, 'indice', 'indices')} · ${frPlural(mistakes, 'erreur', 'erreurs')}`,

  // Relative feedback on the fresh solve (personal, offline, before any submit).
  'win.personal.first': ({ bucket }) =>
    `Ta première partie en ${bucket} – il y a désormais un temps à battre.`,
  'win.personal.best': '🏆 Nouveau record !',
  'win.personal.bestDetail': ({ delta, bucket }) => `${delta} de mieux que ton ancien record · ${bucket}`,
  'win.personal.rank': ({ rank, total }) => `Ton ${frOrdinal(rank)} meilleur temps sur ${total} parties`,
  'win.personal.percentile': ({ percent, total, capped }) =>
    `Mieux que ${frPercent(percent)} de tes ${capped ? `${total} dernières parties` : `${total} parties`}`,
  'win.personal.detail': ({ bucket, toBest }) => `${bucket} · ${toBest}`,
  'win.personal.detailRank': ({ rank, total, bucket, toBest }) =>
    `Place ${rank} sur ${total} · ${bucket} · ${toBest}`,
  // The same comparison over a rolling window: how the solve stacks up against
  // current form, not against a record that may be a year old.
  'win.personal.recentBest': ({ days }) => `🔥 Ton meilleur temps depuis ${days} jours`,
  'win.personal.recentPercentile': ({ percent, total, days }) =>
    `${days} derniers jours : mieux que ${frPercent(percent)} de ${frPlural(total, 'partie', 'parties')}`,
  'win.personal.recentRank': ({ rank, total, days }) =>
    `${days} derniers jours : ${frOrdinal(rank)} sur ${total}`,
  'win.personal.toBest.equal': 'à égalité avec ton record',
  'win.personal.toBest.delta': ({ delta }) => `+${delta} par rapport à ton record`,

  // ---------- global leaderboard ----------
  'global.loading': 'Chargement du classement global …',
  'global.unreachable': 'Classement global inaccessible.',
  'global.notSubmitted': 'Pas encore publié – « Publier » t’ajoute ici.',
  'submit.savedLocal': 'Enregistré en local ✓',
  'submit.sending': 'Envoi au classement global …',
  'submit.retrying': ({ attempt, total }) => `Nouvel essai … (${attempt}/${total})`,
  'submit.done': ({ rank, total }) => `Publié : place ${rank} sur ${total} 🌐`,
  'submit.donePercentile': ({ rank, total, percent }) =>
    `Publié : place ${rank} sur ${total} – mieux que ${frPercent(percent)} des entrées 🌐`,
  'submit.unreachable': 'Classement global inaccessible – enregistré en local ✓. Réessayer ?',
  'submit.rejectedSaved': ({ text }) => `${text} – enregistré en local ✓`,
  'submit.reject.implausibleTime': 'Refusé au niveau global : temps jugé impossible',
  'submit.reject.badCounters':
    'Refusé au niveau global : nombre d’indices/d’erreurs hors des limites autorisées',
  'submit.reject.badSize': 'Refusé au niveau global : taille de grille non autorisée',
  'submit.reject.badDifficulty': 'Refusé au niveau global : difficulté non autorisée',
  'submit.reject.rateLimited': 'Trop d’entrées en peu de temps – réessaie dans une minute',
  'submit.reject.unknown': ({ reason }) => `Refusé au niveau global (« ${reason} »)`,
  'submit.reject.generic': 'Refusé au niveau global',

  // ---------- settings ----------
  'settings.title': 'Réglages',
  'settings.size': 'Taille de la grille',
  'settings.difficulty': 'Difficulté',
  'settings.difficulty.hardOnly': 'En taille 12, seules les grilles difficiles sont possibles.',
  'settings.language.label': 'Langue',
  'settings.language.auto': 'Automatique (navigateur)',
  'settings.language.hint':
    'Changer de langue recharge le jeu – une partie en cours est perdue.',
  'settings.language.confirm':
    'Changer de langue maintenant ? Le jeu se recharge et la partie en cours est perdue.',
  'settings.quick.label': 'Mode rapide',
  'settings.quick.hint':
    'Poser une dame pointe automatiquement sa ligne, sa colonne, sa région de couleur et les cases voisines.',
  'settings.live.label': 'Vérification en direct',
  'settings.live.hint':
    'Affiche en continu un voyant indiquant si ta grille est toujours sans erreur – sans révéler où se trouve l’erreur. Il apparaît peu après ton dernier coup. Sans cette option, le statut reste disponible à tout moment via « Vérifier ».',
  'settings.intro.label': 'Animation d’ouverture',
  'settings.intro.hint':
    'Pendant la génération d’une grille, les régions de couleur se déploient en animation tandis que le plateau tourne – de quoi occuper l’attente sur les grandes grilles.',
  'settings.sound.label': 'Son',
  'settings.sound.hint':
    'Effets sonores courts et discrets pour la pose d’une dame, les points, les indices et la résolution. Peuvent aussi être coupés directement via l’icône haut-parleur en haut.',
  'settings.voice.label': 'Commande vocale (bêta)',
  'settings.voice.hint':
    'Pilote le jeu à la voix (Chrome/Edge, micro requis). Le ⓘ du panneau vocal explique chaque commande.',
  'settings.voice.unsupported': ' Remarque : indisponible dans ce navigateur.',
  'settings.voice.germanOnly':
    ' Les commandes vocales n’existent qu’en allemand pour l’instant – passe la langue sur Deutsch pour les utiliser.',
  'settings.voiceEdge.label': 'Grandes coordonnées sur le bord',
  'settings.voiceEdge.hint':
    'Affiche les lettres de colonne et les numéros de ligne en grand sur le bord de la grille – comme sur un échiquier – au lieu de les mettre en petit dans le coin de chaque case.',
  'settings.debug.label': 'Mode débogage',
  'settings.debug.hint':
    'Affiche un bouton qui copie dans le presse-papiers tout ce qui concerne la grille actuelle (indice compris) – utile pour signaler un problème.',
  'settings.debugExt.label': 'Mode débogage étendu',
  'settings.debugExt.hint':
    'Enregistre les 10 derniers coups (transcription vocale comprise) et ce que chaque « Annuler » a retiré. Ce journal est inclus dans « Copier le débogage » – utile pour signaler un problème du mode vocal.',
  'settings.note': 'Les changements de taille ou de difficulté prennent effet à la prochaine partie.',
  'settings.apply': 'Appliquer & rejouer',
  'settings.close': 'Fermer',

  // ---------- share / QR dialog ----------
  'qr.button': 'Partager le jeu par QR code',
  'qr.title': 'Partager le jeu',
  'qr.hint':
    'Dirige l’appareil photo d’un téléphone vers le code – le jeu s’ouvre directement dans le navigateur, sans rien installer.',
  'qr.alt': 'QR code de l’adresse web du jeu',

  // ---------- leaderboard modal ----------
  'lb.title': '🏆 Classement',

  // ---------- hint card chrome ----------
  'hintcard.apply': 'Appliquer',
  'hintcard.close': 'Fermer',
  'legend.reason': 'raison',
  'legend.target': 'poser ici',
  'legend.x': 'exclu',

  // ---------- debug ----------
  'debug.copied': '✓ Copié',
  'debug.copyFailed': 'Échec de la copie',
  'debug.copiedSuffix': ' (débogage copié 📋)',

  // ---------- party mode ----------
  'party.kicker': 'Succès débloqué',
  'party.title': 'Mode fête',
  'party.text':
    'Tu as vraiment pointé <strong>chaque case, sans exception</strong> – pas une seule dame à l’horizon. Le chaos absolu. Nous sommes profondément impressionnés. 🎉',
  'party.close': 'Terminer la fête',

  // ---------- hints (js/hint.js) ----------
  // Unit words are separate keys because several hint sentences name a unit; the
  // sentences themselves are still whole per language, never assembled from
  // fragments. All three are feminine — see the header note.
  'hint.unit.region': 'région de couleur',
  'hint.unit.row': 'ligne',
  'hint.unit.col': 'colonne',

  'hint.apply.placeQueen': 'Poser la dame',
  'hint.apply.markCell': 'Marquer la case',
  'hint.apply.markCells': 'Marquer les cases',
  'hint.apply.removeQueen': 'Retirer la dame',
  'hint.apply.removeMark': 'Retirer la marque',

  'hint.place.title': ({ unit }) => `Une seule case libre dans la ${unit}`,
  'hint.place.text': ({ unit }) =>
    `C’est la seule case encore libre dans cette ${unit} – toutes les autres sont exclues. La dame doit aller ici.`,

  'hint.confine.colorRow.title': 'La couleur fixe la ligne',
  'hint.confine.colorRow.text':
    'Toutes les cases possibles de cette couleur se trouvent sur une même ligne. La dame de cette ligne appartient donc à cette couleur – les autres cases de la ligne sont exclues.',
  'hint.confine.colorCol.title': 'La couleur fixe la colonne',
  'hint.confine.colorCol.text':
    'Toutes les cases possibles de cette couleur se trouvent dans une même colonne. La dame de cette colonne appartient donc à cette couleur – les autres cases de la colonne sont exclues.',
  'hint.confine.rowColor.title': 'La ligne fixe la couleur',
  'hint.confine.rowColor.text':
    'Sur cette ligne, seules des cases d’une seule et même couleur restent possibles. La dame de cette couleur se trouve donc sur cette ligne – ses cases sur les autres lignes sont exclues.',
  'hint.confine.colColor.title': 'La colonne fixe la couleur',
  'hint.confine.colColor.text':
    'Dans cette colonne, seules des cases d’une seule et même couleur restent possibles. La dame de cette couleur se trouve donc dans cette colonne – ses cases dans les autres colonnes sont exclues.',

  'hint.deadEnd.title': ({ unit }) => `Bloquerait une ${unit}`,
  'hint.deadEnd.text': ({ unit, many }) =>
    `Une dame sur ${many ? 'l’une de ces cases' : 'cette case'} exclurait toutes les cases encore libres de cette ${unit} (même ligne, même colonne, même couleur ou case directement voisine). Or cette ${unit} a besoin d’une dame, donc ${many ? 'ces cases sont exclues' : 'cette case est exclue'}.`,

  'hint.crowd.rowsRegions.title': ({ k }) => `${k} couleurs ne tiennent que dans ${k} lignes`,
  'hint.crowd.rowsRegions.text': ({ k }) =>
    `Les ${k} lignes en surbrillance ne contiennent que ${k} couleurs. Ces ${k} couleurs doivent donc occuper exactement ces lignes – les mêmes couleurs sont exclues sur toutes les autres lignes (hachurées).`,
  'hint.crowd.colsRegions.title': ({ k }) => `${k} couleurs ne tiennent que dans ${k} colonnes`,
  'hint.crowd.colsRegions.text': ({ k }) =>
    `Les ${k} colonnes en surbrillance ne contiennent que ${k} couleurs. Ces ${k} couleurs doivent donc occuper exactement ces colonnes – les mêmes couleurs sont exclues dans toutes les autres colonnes (hachurées).`,
  'hint.crowd.regionsRows.title': ({ k }) => `${k} couleurs occupent ${k} lignes`,
  'hint.crowd.regionsRows.text': ({ k }) =>
    `Les ${k} couleurs en surbrillance ne tiennent que dans ${k} lignes. Ces lignes appartiennent donc à ces couleurs – les autres couleurs y sont exclues (hachurées).`,
  'hint.crowd.regionsCols.title': ({ k }) => `${k} couleurs occupent ${k} colonnes`,
  'hint.crowd.regionsCols.text': ({ k }) =>
    `Les ${k} couleurs en surbrillance ne tiennent que dans ${k} colonnes. Ces colonnes appartiennent donc à ces couleurs – les autres couleurs y sont exclues (hachurées).`,

  'hint.mistake.queen.title': 'Cette dame ne convient pas',
  'hint.mistake.queen.text':
    'Cette dame ne peut pas faire partie de la solution. Reprends-la et essaie un autre emplacement.',
  'hint.markedSolution.place.title': 'La dame doit aller ici',
  'hint.markedSolution.place.text': ({ unit }) =>
    `Cette case est pointée comme exclue – or c’est la seule case encore libre de sa ${unit}. Retire le point et pose la dame ici.`,
  'hint.markedSolution.mistake.title': 'Une dame doit aller ici',
  'hint.markedSolution.mistake.text':
    'Cette case est pointée comme exclue alors qu’une dame doit s’y trouver. Retire le point.',

  'hint.solved.title': 'Tout est résolu',
  'hint.solved.text': 'Toutes les dames sont bien placées – bravo !',
  'hint.reveal.title': 'Dame suivante',
  'hint.reveal.text': 'La prochaine dame va ici.',
  'hint.none.title': 'Aucun indice',
  'hint.none.text': 'Aucun indice simple n’est disponible pour le moment.',
};
