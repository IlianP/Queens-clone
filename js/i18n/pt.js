// i18n/pt.js — Portuguese language pack (Brazilian wording).
//
// See js/i18n.js for the contract and js/i18n/de.js for the conventions all
// packs share: identical key sets, values are strings or functions of one
// params object, emoji stay untranslated.
//
// One pack, both variants: the wording is Brazilian (the larger audience by a
// wide margin) but avoids BR-only colloquialisms, so a European Portuguese
// reader is never left guessing. `resolveLanguage` maps every pt-* locale to
// this pack, so pt-PT lands here too.
//
// Terminology is pinned to the Portuguese name of the underlying puzzle — the
// "problema das oito rainhas" — so the piece is a **rainha**. The board
// vocabulary follows the chess register: `casa` (cell), `linha`, `coluna`,
// `região de cor`. All three unit words are feminine, which is why the hint
// sentences can interpolate a bare "a ${unit}" without the pack carrying a
// gender — the same break the fr/es packs get.
//
// Register is informal "você/tu" phrasing throughout, matching en/de/fr/es.
//
// Bundle constraint (this file is concatenated into the classic-script Artifact
// bundle): no `import.meta`, and no top-level name collisions — hence the
// pt-prefixed helper names.

// Portuguese plural: only 1 is singular.
//
// This DELIBERATELY departs from Intl.PluralRules('pt'), which classes 0 as
// `one` (its rule is i = 0..1). That CLDR category is about agreement for
// values below two in general — "0,5 segundo" really is singular — but integer
// zero takes the plural in Portuguese: a UI writes "0 dicas", never "0 dica".
// French genuinely does have the singular-zero rule and frPlural follows it;
// Portuguese does not, so this is not a copy of the French helper. Everything
// that IS locale data (percent, dates, relative time) is still delegated to
// Intl below rather than typed by hand.
const ptPlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// 2.º, 3.º … the masculine ordinal indicator, agreeing with "tempo".
const ptOrdinal = (n) => `${n}.º`;
// Portuguese writes "88%" with no space — the opposite of de/fr/es/ru. Which is
// exactly why this is Intl's call and not a hand-typed character; see
// js/i18n/en.js for why the helper is per-pack rather than shared.
const ptLocale = 'pt-BR';
const ptPercent = (n) =>
  new Intl.NumberFormat(ptLocale, { style: 'percent', maximumFractionDigits: 0 }).format(Number(n) / 100);

// Age of a leaderboard entry ("há 3 dias") and its exact date. Intl owns both
// wordings: relative time has its own irregulars per language ("ontem", not
// "há 1 dia"), and a date format is a locale convention, not a translation.
const ptRelTime = new Intl.RelativeTimeFormat(ptLocale, { numeric: 'auto', style: 'short' });
const ptDateTime = new Intl.DateTimeFormat(ptLocale, { dateStyle: 'medium', timeStyle: 'short' });

export const I18N_PT = {
  // ---------- meta ----------
  'lang.htmlLang': 'pt',

  // ---------- top bar / actions ----------
  'ui.newGame': 'Novo jogo',
  'ui.leaderboard': 'Classificação',
  'ui.settings': 'Ajustes',
  'ui.board': 'Tabuleiro',
  'ui.check': '🔎 Verificar',
  'ui.hint': '💡 Dica',
  // The price tag on the hint button (bracketed, it trails a label) and the
  // pill that flies off it when a hint is actually charged (bare, it stands
  // alone). Two presentations, one number — both are handed HINT_PENALTY, so
  // the label, the animation and the score cannot quote different figures.
  'ui.hint.cost': ({ seconds }) => `+${seconds} s`,
  'ui.hint.costLabel': ({ seconds }) => `(+${seconds} s)`,
  'ui.hint.title': ({ seconds }) =>
    `Uma dica nova soma ${seconds} segundos ao seu tempo. Reabrir a mesma dica é grátis.`,
  'ui.undo': '↶ Desfazer',
  'ui.reset': '🔄 Reiniciar',
  'ui.debugCopy': '🐞 Copiar depuração',
  'ui.sound.mute': 'Silenciar o som',
  'ui.sound.unmute': 'Ativar o som',
  'ui.sound.on': 'Som ligado',
  'ui.sound.off': 'Som desligado',
  'ui.footerHint':
    'Um toque por casa: vazia → ponto → 👑 → vazia. Uma rainha por linha, coluna e cor – e nenhuma pode encostar em outra.',

  // ---------- board messages ----------
  'msg.almost': 'Quase! Ainda há conflitos.',
  'check.errors': '✗ Há erros',
  'check.ok': '✓ Sem erros',

  // ---------- difficulty ----------
  'difficulty.easy': 'Fácil',
  'difficulty.medium': 'Média',
  'difficulty.hard': 'Difícil',
  'bucket.label': ({ size, difficulty }) => `${size}×${size} · ${difficulty}`,

  // ---------- durations ----------
  'time.seconds': ({ seconds }) => `${seconds} s`,
  'time.minutes': ({ time }) => `${time} min`,

  // ---------- score lists ----------
  'score.empty': 'Ainda não há registros – estreie a classificação!',
  'score.anonymous': 'Anônimo',
  'score.you': 'Você',
  // `unit` arrives as an Intl unit kind ('day', 'month', …), never as a word —
  // the fallback only catches a caller passing something else entirely.
  'score.age': ({ value, unit }) => ptRelTime.format(-value, typeof unit === 'string' ? unit : 'day'),
  'score.rowDate': ({ at }) => `Registrado: ${ptDateTime.format(new Date(at))}`,
  'score.rowTitle': ({ time, hints, mistakes, penalty }) =>
    `Tempo de jogo ${time} · ${ptPlural(hints, 'dica', 'dicas')}${hints ? ` (+${penalty})` : ''} · ${ptPlural(mistakes, 'erro', 'erros')}`,

  // ---------- win card ----------
  'win.title': '🎉 Resolvido!',
  'win.viewBoard': 'Ver o tabuleiro resolvido',
  'win.tab.local': 'Local',
  'win.tab.global': 'Global 🌐',
  'win.tab.period': ({ days }) => `${days} dias`,
  'win.tab.periodAria': ({ days }) => `Classificação dos últimos ${days} dias`,
  'win.nickname.placeholder': 'Seu nome',
  'win.nickname.aria': 'Seu nome para a classificação',
  'win.submit': 'Publicar',
  'win.save': 'Salvar',
  'win.retry': 'Tentar de novo',
  'win.newGame': 'Novo jogo',
  'win.settings': '⚙ Ajustes',
  'win.debugCopy': '📋 Copiar estado de depuração',
  'win.breakdown': ({ time, hints, mistakes, penalty }) =>
    `Tempo de jogo ${time} · ${ptPlural(hints, 'dica', 'dicas')}${hints ? ` (+${penalty})` : ''} · ${ptPlural(mistakes, 'erro', 'erros')}`,

  // Relative feedback on the fresh solve (personal, offline, before any submit).
  'win.personal.first': ({ bucket }) =>
    `Seu primeiro jogo em ${bucket} – a partir de agora há uma marca a bater.`,
  'win.personal.best': '🏆 Novo recorde!',
  'win.personal.bestDetail': ({ delta, bucket }) => `${delta} melhor que seu recorde anterior · ${bucket}`,
  'win.personal.rank': ({ rank, total }) => `Seu ${ptOrdinal(rank)} melhor tempo de ${total} jogos`,
  'win.personal.percentile': ({ percent, total, capped }) =>
    `Melhor que ${ptPercent(percent)} dos seus ${capped ? `${total} últimos jogos` : `${total} jogos`}`,
  'win.personal.detail': ({ bucket, toBest }) => `${bucket} · ${toBest}`,
  'win.personal.detailRank': ({ rank, total, bucket, toBest }) =>
    `Posição ${rank} de ${total} · ${bucket} · ${toBest}`,
  // The same comparison over a rolling window: how the solve stacks up against
  // current form, not against a record that may be a year old.
  'win.personal.recentBest': ({ days }) => `🔥 Seu melhor tempo em ${days} dias`,
  'win.personal.recentPercentile': ({ percent, total, days }) =>
    `Últimos ${days} dias: melhor que ${ptPercent(percent)} de ${ptPlural(total, 'jogo', 'jogos')}`,
  'win.personal.recentRank': ({ rank, total, days }) =>
    `Últimos ${days} dias: posição ${rank} de ${total}`,
  'win.personal.toBest.equal': 'empatado com seu melhor tempo',
  'win.personal.toBest.delta': ({ delta }) => `+${delta} em relação ao seu melhor tempo`,

  // ---------- global leaderboard ----------
  'global.loading': 'Carregando a classificação global …',
  'global.unreachable': 'Classificação global inacessível.',
  'global.notSubmitted': 'Ainda não publicado – “Publicar” coloca você aqui.',
  'submit.savedLocal': 'Salvo localmente ✓',
  'submit.sending': 'Enviando para a classificação global …',
  'submit.retrying': ({ attempt, total }) => `Nova tentativa … (${attempt}/${total})`,
  'submit.done': ({ rank, total }) => `Publicado: posição ${rank} de ${total} 🌐`,
  'submit.donePercentile': ({ rank, total, percent }) =>
    `Publicado: posição ${rank} de ${total} – melhor que ${ptPercent(percent)} dos registros 🌐`,
  'submit.unreachable': 'Classificação global inacessível – salvo localmente ✓. Tentar de novo?',
  'submit.rejectedSaved': ({ text }) => `${text} – salvo localmente ✓`,
  'submit.reject.implausibleTime': 'Recusado no servidor: tempo considerado impossível',
  'submit.reject.badCounters':
    'Recusado no servidor: número de dicas ou erros fora do intervalo permitido',
  'submit.reject.badSize': 'Recusado no servidor: tamanho de tabuleiro não permitido',
  'submit.reject.badDifficulty': 'Recusado no servidor: dificuldade não permitida',
  'submit.reject.rateLimited': 'Registros demais em pouco tempo – tente de novo em um minuto',
  'submit.reject.unknown': ({ reason }) => `Recusado no servidor (“${reason}”)`,
  'submit.reject.generic': 'Recusado no servidor',

  // ---------- settings ----------
  'settings.title': 'Ajustes',
  'settings.size': 'Tamanho do tabuleiro',
  'settings.difficulty': 'Dificuldade',
  'settings.difficulty.hardOnly': 'No tamanho 12 só existem tabuleiros difíceis.',
  'settings.language.label': 'Idioma',
  'settings.language.auto': 'Automático (navegador)',
  'settings.language.hint':
    'Trocar de idioma recarrega o jogo – a partida em andamento se perde.',
  'settings.language.confirm':
    'Trocar de idioma agora? O jogo recarrega e a partida em andamento se perde.',
  'settings.quick.label': 'Modo rápido',
  'settings.quick.hint':
    'Ao colocar uma rainha, sua linha, sua coluna, sua região de cor e as casas vizinhas são marcadas com pontos automaticamente.',
  'settings.live.label': 'Verificação ao vivo',
  'settings.live.hint':
    'Mostra continuamente um indicador de que o tabuleiro segue sem erros – sem revelar onde está o erro. Aparece pouco depois da sua última jogada. Sem essa opção, o estado pode ser consultado a qualquer momento com “Verificar”.',
  'settings.intro.label': 'Animação de abertura',
  'settings.intro.hint':
    'Enquanto um tabuleiro é gerado, as regiões de cor se espalham em animação enquanto o tabuleiro gira – preenche a espera nos tabuleiros grandes.',
  'settings.sound.label': 'Som',
  'settings.sound.hint':
    'Efeitos sonoros curtos e discretos ao colocar uma rainha, marcar pontos, pedir dicas e resolver. Também dá para silenciar direto pelo ícone de alto-falante no topo.',
  'settings.voice.label': 'Controle por voz (beta)',
  'settings.voice.hint':
    'Comande o jogo pela voz (Chrome/Edge, microfone necessário). O ⓘ no painel de voz explica cada comando.',
  'settings.voice.unsupported': ' Observação: indisponível neste navegador.',
  'settings.voice.germanOnly':
    ' Por enquanto os comandos de voz só existem em alemão – mude o idioma para Deutsch para usá-los.',
  'settings.voiceEdge.label': 'Coordenadas grandes na borda',
  'settings.voiceEdge.hint':
    'Mostra as letras das colunas e os números das linhas em tamanho grande na borda do tabuleiro – como num tabuleiro de xadrez – em vez de pequenos no canto de cada casa.',
  'settings.debug.label': 'Modo de depuração',
  'settings.debug.hint':
    'Mostra um botão que copia para a área de transferência tudo sobre o tabuleiro atual (inclusive a dica) – útil para relatar um problema.',
  'settings.debugExt.label': 'Modo de depuração estendido',
  'settings.debugExt.hint':
    'Registra as 10 últimas jogadas (inclusive a transcrição de voz) e o que cada “Desfazer” removeu. Esse registro entra no “Copiar depuração” – útil para relatar problemas do modo de voz.',
  'settings.note': 'Mudanças de tamanho ou dificuldade valem a partir do próximo jogo.',
  'settings.apply': 'Aplicar e jogar',
  'settings.close': 'Fechar',

  // ---------- share / QR dialog ----------
  'qr.button': 'Compartilhar o jogo e informações do projeto',
  'qr.title': 'Compartilhar o jogo',
  'qr.hint':
    'Aponte a câmera do celular para o código – o jogo abre direto no navegador, sem instalar nada.',
  'qr.alt': 'Código QR com o endereço do jogo',
  'qr.repoHint':
    'Curioso para saber como funciona, ou tem uma ideia? O projeto é de código aberto no GitHub – issues e pull requests são bem-vindos.',

  // ---------- leaderboard modal ----------
  'lb.title': '🏆 Classificação',

  // ---------- hint card chrome ----------
  'hintcard.apply': 'Aplicar',
  'hintcard.close': 'Fechar',
  'legend.reason': 'motivo',
  'legend.target': 'colocar aqui',
  'legend.x': 'descartada',

  // ---------- debug ----------
  'debug.copied': '✓ Copiado',
  'debug.copyFailed': 'Falha ao copiar',
  'debug.copiedSuffix': ' (depuração copiada 📋)',

  // ---------- party mode ----------
  'party.kicker': 'Conquista desbloqueada',
  'party.title': 'Modo festa',
  'party.text':
    'Você marcou mesmo <strong>cada uma das casas</strong> – nenhuma rainha à vista. Caos absoluto. Estamos profundamente impressionados. 🎉',
  'party.close': 'Encerrar a festa',

  // ---------- hints (js/hint.js) ----------
  // Unit words are separate keys because several hint sentences name a unit; the
  // sentences themselves are still whole per language, never assembled from
  // fragments. All three are feminine — see the header note.
  'hint.unit.region': 'região de cor',
  'hint.unit.row': 'linha',
  'hint.unit.col': 'coluna',

  'hint.apply.placeQueen': 'Colocar a rainha',
  'hint.apply.markCell': 'Marcar a casa',
  'hint.apply.markCells': 'Marcar as casas',
  'hint.apply.removeQueen': 'Tirar a rainha',
  'hint.apply.removeMark': 'Tirar a marca',

  'hint.place.title': ({ unit }) => `Só resta uma casa na ${unit}`,
  'hint.place.text': ({ unit }) =>
    `É a única casa ainda livre nessa ${unit} – todas as outras estão descartadas. A rainha tem de ficar aqui.`,

  'hint.confine.colorRow.title': 'A cor fixa a linha',
  'hint.confine.colorRow.text':
    'Todas as casas possíveis dessa cor ficam numa mesma linha. Logo, a rainha dessa linha pertence a essa cor – as demais casas da linha ficam descartadas.',
  'hint.confine.colorCol.title': 'A cor fixa a coluna',
  'hint.confine.colorCol.text':
    'Todas as casas possíveis dessa cor ficam numa mesma coluna. Logo, a rainha dessa coluna pertence a essa cor – as demais casas da coluna ficam descartadas.',
  'hint.confine.rowColor.title': 'A linha fixa a cor',
  'hint.confine.rowColor.text':
    'Nessa linha só continuam possíveis casas de uma única cor. Logo, a rainha dessa cor está nessa linha – suas casas em outras linhas ficam descartadas.',
  'hint.confine.colColor.title': 'A coluna fixa a cor',
  'hint.confine.colColor.text':
    'Nessa coluna só continuam possíveis casas de uma única cor. Logo, a rainha dessa cor está nessa coluna – suas casas em outras colunas ficam descartadas.',

  'hint.deadEnd.title': ({ unit }) => `Bloquearia uma ${unit}`,
  'hint.deadEnd.text': ({ unit, many }) =>
    `Uma rainha ${many ? 'em qualquer uma dessas casas' : 'nessa casa'} descartaria todas as casas ainda livres dessa ${unit} (mesma linha, mesma coluna, mesma cor ou casa vizinha). Mas como essa ${unit} precisa de uma rainha, ${many ? 'essas casas ficam descartadas' : 'essa casa fica descartada'}.`,

  'hint.crowd.rowsRegions.title': ({ k }) => `${k} cores cabem em apenas ${k} linhas`,
  'hint.crowd.rowsRegions.text': ({ k }) =>
    `Nas ${k} linhas destacadas aparecem apenas ${k} cores. Essas ${k} cores têm de ir exatamente para essas linhas – as mesmas cores ficam descartadas em todas as outras linhas (hachuradas).`,
  'hint.crowd.colsRegions.title': ({ k }) => `${k} cores cabem em apenas ${k} colunas`,
  'hint.crowd.colsRegions.text': ({ k }) =>
    `Nas ${k} colunas destacadas aparecem apenas ${k} cores. Essas ${k} cores têm de ir exatamente para essas colunas – as mesmas cores ficam descartadas em todas as outras colunas (hachuradas).`,
  'hint.crowd.regionsRows.title': ({ k }) => `${k} cores ocupam ${k} linhas`,
  'hint.crowd.regionsRows.text': ({ k }) =>
    `As ${k} cores destacadas cabem em apenas ${k} linhas. Logo, essas linhas pertencem a essas cores – as outras cores ficam descartadas nelas (hachuradas).`,
  'hint.crowd.regionsCols.title': ({ k }) => `${k} cores ocupam ${k} colunas`,
  'hint.crowd.regionsCols.text': ({ k }) =>
    `As ${k} cores destacadas cabem em apenas ${k} colunas. Logo, essas colunas pertencem a essas cores – as outras cores ficam descartadas nelas (hachuradas).`,

  'hint.mistake.queen.title': 'Essa rainha não encaixa',
  'hint.mistake.queen.text':
    'Essa rainha não pode fazer parte da solução. Tire-a e tente outro lugar.',
  'hint.markedSolution.place.title': 'A rainha vai aqui',
  'hint.markedSolution.place.text': ({ unit }) =>
    `Essa casa está marcada com um ponto como descartada – mas é a única casa ainda livre na sua ${unit}. Tire o ponto e coloque a rainha aqui.`,
  'hint.markedSolution.mistake.title': 'Aqui vai uma rainha',
  'hint.markedSolution.mistake.text':
    'Essa casa está marcada com um ponto como descartada, embora aqui tenha de ficar uma rainha. Tire o ponto.',

  'hint.solved.title': 'Tudo resolvido',
  'hint.solved.text': 'Todas as rainhas estão no lugar certo – muito bem!',
  'hint.reveal.title': 'Próxima rainha',
  'hint.reveal.text': 'A próxima rainha vai aqui.',
  'hint.none.title': 'Sem dica',
  'hint.none.text': 'Agora não há nenhuma dica simples disponível.',
};
