// Pure-Node test for fetchPlayerRank in js/leaderboard.js — the read behind
// "Platz 3 von 3 Spielern" instead of "Platz 28 von 83".
//
// Like its siblings leaderboard-period.mjs / leaderboard-retry.mjs this replaces
// the global `fetch` with a scripted mock, so the live Supabase project is never
// contacted.
//
// What is actually at stake here is not the happy path — it's that a wrong
// answer must become NO answer. The status line falls back to the entry-based
// sentence whenever this resolves null, and that fallback is the only thing
// standing between an un-migrated database (or a malformed row) and a placement
// shown to the player that nothing supports.
//
// Run: node tests/logic/player-rank.mjs

import { fetchPlayerRank } from '../../js/leaderboard.js';

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL: ' + msg);
};
const eq = (got, want, msg) => {
  if (got !== want) fail(`${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

function installFetch(step) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse((init && init.body) || '{}') });
    if (step.throw) throw new Error('network down');
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      statusText: `status ${step.status}`,
      json: async () => step.body,
      text: async () => JSON.stringify(step.body),
    };
  };
  return calls;
}

const realFetch = globalThis.fetch;

try {
  // 1) The happy path, and the exact RPC contract. player_rank takes the bucket,
  //    the name and the freshly submitted values; the name travels as sent (the
  //    server normalises it), and an absent name must still go out as '' rather
  //    than null — the SQL keys anonymous rows off the empty string.
  {
    const calls = installFetch({ status: 200, body: [{ rank: 3, total: 3, is_best: true }] });
    const got = await fetchPlayerRank(8, 'hard', 'D', 15, 15, 'a1b2c3d4-0000-4000-8000-000000000001');
    eq(calls.length, 1, 'one request');
    eq(calls[0].url.endsWith('/rpc/player_rank'), true, 'calls player_rank');
    eq(calls[0].body.p_size, 8, 'p_size');
    eq(calls[0].body.p_difficulty, 'hard', 'p_difficulty');
    eq(calls[0].body.p_name, 'D', 'p_name');
    eq(calls[0].body.p_score, 15, 'p_score');
    eq(calls[0].body.p_seconds, 15, 'p_seconds');
    eq(calls[0].body.p_submission_id, 'a1b2c3d4-0000-4000-8000-000000000001', 'p_submission_id');
    eq(got && got.rank, 3, 'rank');
    eq(got && got.total, 3, 'total');
    eq(got && got.isBest, true, 'isBest');
  }

  // 2) An empty name is sent as '' — never null, never omitted.
  {
    const calls = installFetch({ status: 200, body: [{ rank: 1, total: 4, is_best: true }] });
    await fetchPlayerRank(10, 'hard', '', 30, 30, 'a1b2c3d4-0000-4000-8000-000000000002');
    eq(calls[0].body.p_name, '', 'empty name travels as empty string');
    const calls2 = installFetch({ status: 200, body: [{ rank: 1, total: 4, is_best: true }] });
    await fetchPlayerRank(10, 'hard', null, 30, 30);
    eq(calls2[0].body.p_name, '', 'null name travels as empty string');
  }

  // 2b) The submission id is what identifies an anonymous submitter — a name
  //     can't, because an empty name is deliberately not a shared identity. An
  //     absent one must go out as an explicit null rather than be dropped: the
  //     server switches to its legacy heuristic on null, and a MISSING key would
  //     leave the parameter at its default, which is the same thing today but
  //     stops being so the moment the default changes.
  {
    const calls = installFetch({ status: 200, body: [{ rank: 1, total: 4, is_best: true }] });
    await fetchPlayerRank(10, 'hard', '', 30, 30);
    eq('p_submission_id' in calls[0].body, true, 'p_submission_id is always present');
    eq(calls[0].body.p_submission_id, null, 'an absent submission id travels as null');
    const calls2 = installFetch({ status: 200, body: [{ rank: 1, total: 4, is_best: true }] });
    await fetchPlayerRank(10, 'hard', '', 30, 30, '');
    eq(calls2[0].body.p_submission_id, null, 'an empty submission id travels as null, not ""');
  }

  // 3) is_best false survives — this is what turns "Platz 1" into "deine beste
  //    hält Platz 1", and silently dropping it would credit the solve just
  //    submitted with a placement an older run earned.
  {
    installFetch({ status: 200, body: [{ rank: 1, total: 3, is_best: false }] });
    const got = await fetchPlayerRank(8, 'hard', 'Goose', 18, 18);
    eq(got && got.isBest, false, 'isBest false is preserved');
  }

  // 4) A missing is_best reads as true. An older function shape says nothing
  //    about it, and "not your best" must never be claimed without the server
  //    actually saying so.
  {
    installFetch({ status: 200, body: [{ rank: 2, total: 9 }] });
    const got = await fetchPlayerRank(8, 'hard', 'Goose', 9, 9);
    eq(got && got.isBest, true, 'absent is_best defaults to true');
  }

  // 5) PostgREST may answer with a bare object instead of a one-row array.
  {
    installFetch({ status: 200, body: { rank: 2, total: 5, is_best: true } });
    const got = await fetchPlayerRank(8, 'hard', 'Goose', 9, 9);
    eq(got && got.rank, 2, 'bare object is accepted');
  }

  // 6) EVERY way of not knowing resolves to null. The un-migrated database (404)
  //    is the one that matters in practice — it is the feature gate — but a
  //    nonsense row must fail the same way rather than reaching the player.
  {
    const cases = [
      ['404 (SQL not re-run)', { status: 404, body: { message: 'not found' } }],
      ['401', { status: 401, body: {} }],
      ['500', { status: 500, body: {} }],
      ['network down', { throw: true }],
      ['empty array (server cannot place us)', { status: 200, body: [] }],
      ['null body', { status: 200, body: null }],
      ['rank below 1', { status: 200, body: [{ rank: 0, total: 3, is_best: true }] }],
      ['rank beyond the field', { status: 200, body: [{ rank: 4, total: 3, is_best: true }] }],
      ['empty field', { status: 200, body: [{ rank: 1, total: 0, is_best: true }] }],
      ['non-numeric rank', { status: 200, body: [{ rank: 'x', total: 3, is_best: true }] }],
      ['missing total', { status: 200, body: [{ rank: 1, is_best: true }] }],
    ];
    for (const [label, step] of cases) {
      installFetch(step);
      const got = await fetchPlayerRank(8, 'hard', 'Goose', 9, 9);
      eq(got, null, `fails soft to null: ${label}`);
    }
  }

  // 7) Strings from PostgREST's bigint columns are numbers on the way out — the
  //    UI does arithmetic on them (globalPercentile), and "3" - 1 would be fine
  //    while "3" < 5 would not.
  {
    installFetch({ status: 200, body: [{ rank: '2', total: '8', is_best: true }] });
    const got = await fetchPlayerRank(8, 'hard', 'Goose', 9, 9);
    eq(typeof (got && got.rank), 'number', 'rank is a number');
    eq(typeof (got && got.total), 'number', 'total is a number');
    eq(got && got.total, 8, 'total value');
  }
} finally {
  globalThis.fetch = realFetch;
}

// --- the sentences themselves, in all six languages --------------------------
// A rank among players carries a COUNTED NOUN, which none of the previous submit
// copy did ("Platz 3 von 83" needs no grammar). That is a new way for a pack to
// be wrong, and it is invisible to verify-i18n: identical key sets and matching
// parameters would still let a pack print "von 1 Spielern". So check the forms
// where each language actually switches.
{
  const { t, setLanguage } = await import('../../js/i18n.js');

  // [language, total, the substring that must appear]
  const FORMS = [
    ['en', 1, 'of 1 player '],
    ['en', 5, 'of 5 players'],
    ['de', 1, 'von 1 Spieler '],
    ['de', 5, 'von 5 Spielern'],
    ['fr', 1, 'sur 1 joueur '],
    ['fr', 5, 'sur 5 joueurs'],
    ['es', 1, 'de 1 jugador '],
    ['es', 5, 'de 5 jugadores'],
    ['pt', 1, 'de 1 jogador '],
    ['pt', 5, 'de 5 jogadores'],
    // Russian switches three ways and repeats modulo 100, so 21 is not 1 and
    // 2 is not 5. After "из" the noun is genitive: singular for 1 and 21,
    // plural for everything else.
    ['ru', 1, 'из 1 игрока '],
    ['ru', 2, 'из 2 игроков'],
    ['ru', 5, 'из 5 игроков'],
    ['ru', 21, 'из 21 игрока'],
  ];
  for (const [lang, total, want] of FORMS) {
    setLanguage(lang);
    const line = t('submit.donePlayers', { rank: 1, total });
    if (!line.includes(want)) fail(`[${lang}] donePlayers(total=${total}) should contain "${want}" — got "${line}"`);
  }

  // All three sentences must render in every language, name both numbers, and
  // not leak a template artefact. The not-best one is the newest idea in the
  // set: it has to read as "your BEST holds that place", never as a placement
  // for the solve just submitted.
  for (const [lang] of FORMS) {
    setLanguage(lang);
    for (const key of ['submit.donePlayers', 'submit.donePlayersPercentile', 'submit.donePlayersNotBest']) {
      const line = t(key, { rank: 7, total: 12, percent: 42 });
      if (typeof line !== 'string' || line.length < 10) fail(`[${lang}] ${key} did not render: ${line}`);
      if (!line.includes('7') || !line.includes('12')) fail(`[${lang}] ${key} drops a number: "${line}"`);
      if (/\$\{|undefined|\[object/.test(line)) fail(`[${lang}] ${key} leaks a template artefact: "${line}"`);
      if (key === 'submit.donePlayersPercentile' && !line.includes('42')) {
        fail(`[${lang}] ${key} drops the percentage: "${line}"`);
      }
    }
  }

  // The tab label and its aria-label are a pair: the label is what has to fit in
  // ~75px, the aria-label is where the precision lives. A pack that made them
  // identical would have thrown the precision away without failing anything.
  for (const [lang] of FORMS) {
    setLanguage(lang);
    const label = t('win.tab.local');
    const aria = t('win.tab.localAria');
    if (!label || label.length > 8) fail(`[${lang}] win.tab.local is too long for the tab row: "${label}"`);
    if (!aria || aria.length <= label.length) fail(`[${lang}] win.tab.localAria adds nothing: "${aria}"`);
  }
}

if (failed) process.exit(1);
console.log('PASS: player-rank reads cleanly and every unknown answer fails soft to null');
