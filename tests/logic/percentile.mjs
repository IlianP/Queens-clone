// Pure-Node test for the relative-feedback half of js/highscores.js: the solve
// history store (recordSolve / getSolveScores), the percentile maths
// (percentileBetter, globalPercentile) and the win-screen summary that sits on
// top of them (getPersonalStats).
//
// The store functions talk to localStorage, so this installs a minimal in-memory
// stand-in before importing the module — the module only touches it at call
// time, so a plain global is enough.
//
// Run: node tests/logic/percentile.mjs

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const {
  percentileBetter,
  globalPercentile,
  recordSolve,
  getSolveScores,
  getPersonalStats,
  saveLocalScore,
  seedSolveHistory,
  matchOwnEntry,
  MAX_SOLVE_HISTORY,
  MIN_SOLVES_FOR_PERCENTILE,
  MIN_GLOBAL_FOR_PERCENTILE,
} = await import('../../js/highscores.js');

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL: ' + msg);
};
const eq = (got, want, msg) => {
  if (got !== want) fail(`${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// --- percentileBetter -------------------------------------------------------
// Lower score is better, so a small score beats a field of larger ones.
eq(percentileBetter(10, []), null, 'no other solves → no percentage');
eq(percentileBetter(10, [20, 30, 40, 50]), 100, 'beats everything → 100 %');
eq(percentileBetter(60, [20, 30, 40, 50]), 0, 'beats nothing → 0 %');
eq(percentileBetter(35, [20, 30, 40, 50]), 50, 'beats half → 50 %');
// A tie counts as half a win (standard percentile-rank convention).
eq(percentileBetter(30, [30, 30]), 50, 'all ties → 50 %');
eq(percentileBetter(10, [10, 20]), 75, 'one tie + one win → 75 %');

// Rounding must never claim more than actually happened: 199 of 200 beaten
// rounds to 100 %, but something better still exists, so it reads 99 %.
{
  const others = Array.from({ length: 200 }, (_, i) => 100 + i); // 100..299
  eq(percentileBetter(101, others), 99, '199/200 beaten must not round up to 100 %');
  // Mirror image: beating 1 of 200 must not round down to a flat 0 %.
  eq(percentileBetter(298, others), 1, '1/200 beaten must not round down to 0 %');
  // The genuine extremes still read as such.
  eq(percentileBetter(1, others), 100, 'strictly best → 100 %');
  eq(percentileBetter(999, others), 0, 'strictly worst → 0 %');
}

// --- globalPercentile -------------------------------------------------------
eq(globalPercentile(1, 5), null, 'tiny bucket → no percentage');
eq(globalPercentile(1, MIN_GLOBAL_FOR_PERCENTILE - 1), null, 'just under the threshold → null');
eq(globalPercentile(1, 101), 100, 'rank 1 beats every other entry');
eq(globalPercentile(101, 101), 0, 'last place beats nobody');
eq(globalPercentile(51, 101), 50, 'exact middle → 50 %');
eq(globalPercentile(2, 201), 99, 'rank 2 must not round up to 100 %');
eq(globalPercentile(200, 201), 1, 'second-to-last must not round down to 0 %');
eq(globalPercentile(5, 3), null, 'rank outside the field → null');
eq(globalPercentile(null, 100), null, 'non-numeric rank → null');

// --- history store ----------------------------------------------------------
localStorage.clear();
eq(getSolveScores(9, 'hard').length, 0, 'fresh history is empty');
recordSolve(9, 'hard', 300);
recordSolve(9, 'hard', 200);
recordSolve(9, 'medium', 111); // a different bucket must stay separate
eq(JSON.stringify(getSolveScores(9, 'hard')), '[300,200]', 'history keeps every solve, in order');
eq(JSON.stringify(getSolveScores(9, 'medium')), '[111]', 'buckets are independent');
recordSolve(9, 'hard', NaN);
eq(getSolveScores(9, 'hard').length, 2, 'a bad value is ignored');

// Malformed storage must not throw — it degrades to an empty history.
localStorage.setItem('queens-clone-solves', '{ not json');
eq(getSolveScores(9, 'hard').length, 0, 'corrupt store reads as empty');

// The cap drops the OLDEST solves, keeping the most recent window.
localStorage.clear();
for (let i = 0; i < MAX_SOLVE_HISTORY + 25; i++) recordSolve(7, 'easy', i);
{
  const list = getSolveScores(7, 'easy');
  eq(list.length, MAX_SOLVE_HISTORY, 'history is capped');
  eq(list[0], 25, 'oldest entries fall off first');
  eq(list[list.length - 1], MAX_SOLVE_HISTORY + 24, 'newest entry is kept');
}

// --- getPersonalStats -------------------------------------------------------
localStorage.clear();
{
  const first = getPersonalStats(8, 'medium', 250);
  eq(first.total, 0, 'first solve has no history');
  eq(first.percentile, null, 'first solve has no percentage');
  eq(first.isBest, false, 'first solve is not a "new best" — there is nothing to beat');
  eq(first.bestScore, null, 'no previous best on the first solve');
  eq(first.rank, 1, 'first solve ranks first');
}

// Below the threshold a percentage is suppressed, but the placement still works.
localStorage.clear();
for (const s of [100, 200, 300]) recordSolve(8, 'medium', s);
{
  const st = getPersonalStats(8, 'medium', 150);
  eq(st.total, 3, 'counts previous solves only');
  eq(st.percentile, null, `under ${MIN_SOLVES_FOR_PERCENTILE} solves → no percentage`);
  eq(st.rank, 2, 'ranked behind the one better solve');
  eq(st.isBest, false, 'not a personal best');
  eq(st.bestScore, 100, 'previous best found');
  eq(st.delta, 50, 'distance to the previous best');
}

// Enough history: percentage appears, and a new best is recognised.
localStorage.clear();
for (const s of [100, 200, 300, 400, 500, 600]) recordSolve(8, 'medium', s);
{
  const st = getPersonalStats(8, 'medium', 250);
  eq(st.total, 6, 'six previous solves');
  eq(st.percentile, 67, 'beats four of six → 67 %');
  eq(st.rank, 3, 'third best');
  eq(st.capped, false, 'history nowhere near the cap');

  const best = getPersonalStats(8, 'medium', 50);
  eq(best.isBest, true, 'a strictly better score is a new personal best');
  eq(best.percentile, 100, 'a new best beats everything');
  eq(best.rank, 1, 'a new best ranks first');
  eq(best.delta, 50, 'improvement over the previous best');

  const tie = getPersonalStats(8, 'medium', 100);
  eq(tie.isBest, false, 'matching the best is not beating it');
  eq(tie.delta, 0, 'a tie is zero away from the best');
}

// The all-time best lives on in the top-10 list even after the history has
// rolled past it, so it must still count as the record to beat.
localStorage.clear();
saveLocalScore(6, 'easy', { name: 'Ich', seconds: 40, hints: 0, mistakes: 0, score: 40 });
for (const s of [300, 310, 320]) recordSolve(6, 'easy', s);
{
  const st = getPersonalStats(6, 'easy', 100);
  eq(st.bestScore, 40, 'the all-time best comes from the top-10 list');
  eq(st.isBest, false, '100 does not beat the surviving 40');
}

// --- seedSolveHistory -------------------------------------------------------
// A device that played before the history existed has a full top-10 list and no
// history at all. Left alone, the win card would compare a fresh solve against
// nothing while showing ten past entries right below it.
localStorage.clear();
for (const s of [14, 18, 23, 30]) {
  saveLocalScore(9, 'medium', { name: 'Ich', seconds: s, hints: 0, mistakes: 0, score: s });
}
eq(getSolveScores(9, 'medium').length, 0, 'no history yet (pre-feature device)');
{
  // saveLocalScore records nothing into the history — that only happens via
  // recordSolve — so this really is the "old device" state.
  eq(seedSolveHistory(), 1, 'one bucket seeded');
  eq(JSON.stringify(getSolveScores(9, 'medium')), '[14,18,23,30]', 'seeded from the top-10 scores');
  eq(seedSolveHistory(), 0, 'seeding again does nothing (idempotent)');

  // And the feedback now matches what the list shows instead of "von 0 Partien".
  const st = getPersonalStats(9, 'medium', 19);
  eq(st.total, 4, 'the seeded solves count as previous games');
  eq(st.rank, 3, 'ranked behind 14 and 18');
  eq(st.bestScore, 14, 'best comes from the seeded history');
}

// A bucket that already has history is left untouched (no double counting).
localStorage.clear();
saveLocalScore(7, 'hard', { name: 'Ich', seconds: 90, hints: 0, mistakes: 0, score: 90 });
recordSolve(7, 'hard', 90);
eq(seedSolveHistory(), 0, 'a bucket with history is not seeded');
eq(JSON.stringify(getSolveScores(7, 'hard')), '[90]', 'existing history unchanged');

// Nothing to seed from at all.
localStorage.clear();
eq(seedSolveHistory(), 0, 'no top-10 lists → nothing seeded');

// --- matchOwnEntry ----------------------------------------------------------
{
  const rows = [
    { name: 'IlianP', seconds: 14, hints: 0, mistakes: 0, score: 14 },
    { name: 'Anonym', seconds: 17, hints: 0, mistakes: 0, score: 17 },
    { name: 'IlianP', seconds: 18, hints: 0, mistakes: 0, score: 18 },
    { name: 'Gast', seconds: 18, hints: 0, mistakes: 0, score: 18 },
  ];
  const mine = { name: 'IlianP', seconds: 18, hints: 0, mistakes: 0, score: 18 };
  eq(matchOwnEntry(rows, mine, 2), 2, 'finds the own row');
  eq(matchOwnEntry(rows, mine, 3), 2, 'a wrong hint still finds the only match');
  eq(matchOwnEntry(rows, mine, -1), 2, 'works without a rank hint');
  // Same name, different score/penalties → not us.
  eq(matchOwnEntry(rows, { ...mine, score: 99 }, 2), -1, 'a different score is not our row');
  eq(matchOwnEntry(rows, { ...mine, hints: 1 }, 2), -1, 'a different hint count is not our row');
  eq(matchOwnEntry(rows, { ...mine, name: 'Wer' }, 2), -1, 'a different name is not our row');
  eq(matchOwnEntry(rows, mine, 9), 2, 'a rank beyond the list still matches on values');
  eq(matchOwnEntry([], mine, 0), -1, 'empty list → no highlight');
  eq(matchOwnEntry(null, mine, 0), -1, 'no list → no highlight');

  // Two identical entries (the same solve submitted twice): pick the one the
  // server's rank pointed at.
  const dupes = [
    { name: 'IlianP', seconds: 18, hints: 0, mistakes: 0, score: 18 },
    { name: 'IlianP', seconds: 18, hints: 0, mistakes: 0, score: 18 },
    { name: 'IlianP', seconds: 20, hints: 0, mistakes: 0, score: 20 },
  ];
  eq(matchOwnEntry(dupes, mine, 1), 1, 'ties resolved towards the reported rank');
  eq(matchOwnEntry(dupes, mine, 0), 0, 'ties resolved towards the reported rank (first)');
}

if (failed) {
  console.error('percentile.mjs: FAILED');
  process.exit(1);
}
console.log('percentile.mjs: all checks passed');
