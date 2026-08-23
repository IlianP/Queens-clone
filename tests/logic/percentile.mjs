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
  getSolveEntries,
  getPersonalStats,
  saveLocalScore,
  seedSolveHistory,
  mergeSolveSamples,
  matchOwnEntry,
  MAX_SOLVE_HISTORY,
  MIN_SOLVES_FOR_PERCENTILE,
  MIN_GLOBAL_FOR_PERCENTILE,
  MIN_RECENT_SOLVES,
  RECENT_WINDOW_DAYS,
  RECENT_WINDOW_MS,
} = await import('../../js/highscores.js');

const DAY = 24 * 60 * 60 * 1000;
// A fixed "now" keeps every window assertion reproducible.
const NOW = Date.parse('2026-06-15T12:00:00Z');
const daysAgo = (d) => NOW - d * DAY;
// The history's own shape is dated; most assertions only care about the scores.
const scoresOf = (list) => list.map((e) => e.score);

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

// Every recorded solve is dated, and the raw store keeps it as [score, at] so
// the timestamp survives a reload.
{
  const dated = getSolveEntries(9, 'hard');
  eq(dated.every((e) => Number.isFinite(e.at)), true, 'recorded solves carry a timestamp');
  recordSolve(9, 'hard', 150, daysAgo(3));
  eq(getSolveEntries(9, 'hard')[2].at, daysAgo(3), 'an explicit timestamp is kept verbatim');
  const raw = JSON.parse(localStorage.getItem('queens-clone-solves'))['9-hard'];
  eq(JSON.stringify(raw[2]), JSON.stringify([150, daysAgo(3)]), 'stored as a [score, at] pair');
}

// A history written by the build that predates timestamps is a flat number
// array. It must still read — those solves simply have no date, forever.
localStorage.clear();
localStorage.setItem('queens-clone-solves', JSON.stringify({ '9-hard': [300, 200, 250] }));
{
  eq(JSON.stringify(getSolveScores(9, 'hard')), '[300,200,250]', 'legacy number entries still read');
  eq(getSolveEntries(9, 'hard').every((e) => e.at === null), true, 'legacy entries are undated');
  recordSolve(9, 'hard', 100);
  const raw = JSON.parse(localStorage.getItem('queens-clone-solves'))['9-hard'];
  eq(typeof raw[0], 'number', 'an undated entry round-trips as a bare number');
  eq(Array.isArray(raw[3]), true, 'the new solve is written dated alongside it');
}

// Junk timestamps degrade to "undated" rather than to 1970.
localStorage.clear();
localStorage.setItem(
  'queens-clone-solves',
  JSON.stringify({ '9-hard': [[120, 0], [130, 'gestern'], [140, -5]] })
);
eq(getSolveEntries(9, 'hard').every((e) => e.at === null), true, 'implausible timestamps read as undated');
eq(JSON.stringify(getSolveScores(9, 'hard')), '[120,130,140]', 'but the scores survive');

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

// The all-time best lives on in the top list even after the history has
// rolled past it, so it must still count as the record to beat.
localStorage.clear();
saveLocalScore(6, 'easy', { name: 'Ich', seconds: 40, hints: 0, mistakes: 0, score: 40 });
for (const s of [300, 310, 320]) recordSolve(6, 'easy', s);
{
  const st = getPersonalStats(6, 'easy', 100);
  eq(st.bestScore, 40, 'the all-time best comes from the top list');
  eq(st.isBest, false, '100 does not beat the surviving 40');
}

// --- getPersonalStats: the rolling window -----------------------------------
// The window is the point of the timestamps: "how am I doing lately", separate
// from an all-time record that may be years old.
localStorage.clear();
for (const s of [100, 110, 120, 130, 140, 150]) recordSolve(10, 'hard', s, daysAgo(200)); // long past
for (const s of [300, 310, 320, 330, 340]) recordSolve(10, 'hard', s, daysAgo(5)); // recent form
{
  const st = getPersonalStats(10, 'hard', 305, { now: NOW });
  eq(st.total, 11, 'all-time counts every solve');
  eq(st.rank, 8, 'ranked behind the six old ones and the 300');
  eq(st.recent.days, RECENT_WINDOW_DAYS, 'the window reports its own length');
  eq(st.recent.total, 5, 'the window counts only the dated solves inside it');
  eq(st.recent.rank, 2, 'second-best of the recent five');
  eq(st.recent.percentile, 80, 'beats four of five recent solves');
  eq(st.recent.isBest, false, '305 does not beat the recent 300');
  eq(st.isBest, false, 'and it is nowhere near the all-time best');
  // The motivating case: a personal best *for the current form*, without being
  // an all-time best.
  const form = getPersonalStats(10, 'hard', 290, { now: NOW });
  eq(form.recent.isBest, true, 'better than everything inside the window');
  eq(form.isBest, false, 'but the all-time best from 200 days ago still stands');
  eq(form.recent.delta, 10, 'distance to the best of the window');
}

// Too few solves inside the window → no window figures at all.
localStorage.clear();
for (const s of [100, 110, 120, 130, 140, 150]) recordSolve(10, 'hard', s, daysAgo(200));
for (let i = 0; i < MIN_RECENT_SOLVES - 1; i++) recordSolve(10, 'hard', 300 + i, daysAgo(2));
eq(getPersonalStats(10, 'hard', 305, { now: NOW }).recent, null, 'a near-empty window is dropped');

// A window that covers EVERY solve on record says nothing the all-time line
// doesn't already say, so it is dropped too — no two lines with one message.
localStorage.clear();
for (const s of [300, 310, 320, 330, 340]) recordSolve(10, 'hard', s, daysAgo(5));
eq(getPersonalStats(10, 'hard', 305, { now: NOW }).recent, null, 'window == whole history → dropped');

// Undated solves never enter a window (they can't be placed on the timeline),
// but they still count all-time — an undated solve did happen.
localStorage.clear();
localStorage.setItem('queens-clone-solves', JSON.stringify({ '10-hard': [100, 110, 120, 130] }));
for (const s of [300, 310, 320]) recordSolve(10, 'hard', s, daysAgo(4));
{
  const st = getPersonalStats(10, 'hard', 305, { now: NOW });
  eq(st.total, 7, 'undated solves count all-time');
  eq(st.dated, 3, 'only three of them are dated');
  eq(st.recent.total, 3, 'the window sees the dated three');
  eq(st.recent.rank, 2, 'ranked inside the window on its own scores');
}

// Falling out of the window is what makes it a *rolling* one.
localStorage.clear();
for (const s of [100, 110, 120, 130]) recordSolve(11, 'hard', s, daysAgo(200));
for (const s of [300, 310, 320]) recordSolve(11, 'hard', s, NOW - RECENT_WINDOW_MS + DAY);
eq(getPersonalStats(11, 'hard', 305, { now: NOW }).recent.total, 3, 'just inside the window');
eq(
  getPersonalStats(11, 'hard', 305, { now: NOW + 2 * DAY }).recent,
  null,
  'two days later they have rolled out of it'
);

// --- mergeSolveSamples ------------------------------------------------------
// The two stores overlap, so the merge must add only what the history is
// actually missing — never a second copy of a solve both stores recorded.
{
  const j = (a) => JSON.stringify(scoresOf(a));
  eq(j(mergeSolveSamples([], [30, 20, 10])), '[30,20,10]', 'empty history takes every top score');
  eq(j(mergeSolveSamples([10, 20], [])), '[10,20]', 'no top list → history unchanged');
  eq(j(mergeSolveSamples([20, 10], [10, 20])), '[20,10]', 'fully overlapping stores add nothing');
  // The realistic case: a few solves recorded since the history existed, plus
  // older ones that only ever reached the top list.
  eq(
    j(mergeSolveSamples([82, 68], [24, 36, 68, 82])),
    '[24,36,82,68]',
    'only the unmatched top scores are prepended, oldest-first'
  );
  // Duplicate values are counted, not deduplicated: two 90s in the list and one
  // in the history means one 90 is still missing.
  eq(j(mergeSolveSamples([90], [90, 90])), '[90,90]', 'a second copy in the list counts as a second solve');
  eq(j(mergeSolveSamples([90, 90], [90])), '[90,90]', 'the history may hold more copies than the list');
  // A solve the top list dropped (worse than every listed entry) survives.
  eq(j(mergeSolveSamples([280], [24, 36])), '[24,36,280]', 'history-only scores are kept');
  eq(j(mergeSolveSamples(['x', -1, 40], ['y', 30])), '[30,40]', 'junk values are dropped');
  // At the cap, backfill loses out to real recorded solves.
  {
    const full = Array.from({ length: MAX_SOLVE_HISTORY }, (_, i) => 1000 + i);
    const merged = mergeSolveSamples(full, [1, 2, 3]);
    eq(merged.length, MAX_SOLVE_HISTORY, 'merging cannot exceed the cap');
    eq(merged[merged.length - 1].score, full[full.length - 1], 'the newest real solve is kept');
    eq(merged[0].score, 1000, 'the prepended backfill is what falls off, not a real solve');
  }
  // A backfilled entry keeps the date the top list recorded, which is what lets
  // a seeded device answer "the last 30 days" instead of "unknown, all of them".
  {
    const merged = mergeSolveSamples([{ score: 82, at: daysAgo(1) }], [
      { score: 24, date: new Date(daysAgo(400)).toISOString() },
      { score: 82, date: new Date(daysAgo(1)).toISOString() },
    ]);
    eq(j(merged), '[24,82]', 'only the unmatched entry is added');
    eq(merged[0].at, daysAgo(400), 'and it carries the top list\'s date');
    // A top-list entry without a usable date still merges — just undated.
    const undated = mergeSolveSamples([], [{ score: 30, date: 'irgendwann' }]);
    eq(undated[0].at, null, 'an unparsable date reads as undated');
  }
}

// --- seedSolveHistory -------------------------------------------------------
// A device that played before the history existed has a full top list and no
// history at all. Left alone, the win card would compare a fresh solve against
// nothing while showing all those past entries right below it.
localStorage.clear();
for (const s of [14, 18, 23, 30]) {
  saveLocalScore(9, 'medium', { name: 'Ich', seconds: s, hints: 0, mistakes: 0, score: s });
}
eq(getSolveScores(9, 'medium').length, 0, 'no history yet (pre-feature device)');
{
  // saveLocalScore records nothing into the history — that only happens via
  // recordSolve — so this really is the "old device" state.
  eq(seedSolveHistory(), 1, 'one bucket seeded');
  eq(JSON.stringify(getSolveScores(9, 'medium')), '[14,18,23,30]', 'seeded from the top-list scores');
  eq(seedSolveHistory(), 0, 'seeding again does nothing (idempotent)');

  // And the feedback now matches what the list shows instead of "von 0 Partien".
  const st = getPersonalStats(9, 'medium', 19);
  eq(st.total, 4, 'the seeded solves count as previous games');
  eq(st.rank, 3, 'ranked behind 14 and 18');
  eq(st.bestScore, 14, 'best comes from the seeded history');
}

// A bucket whose history already accounts for every listed solve is left alone —
// the shared solve must not be counted twice.
localStorage.clear();
saveLocalScore(7, 'hard', { name: 'Ich', seconds: 90, hints: 0, mistakes: 0, score: 90 });
recordSolve(7, 'hard', 90);
eq(seedSolveHistory(), 0, 'a fully covered bucket is not touched');
eq(JSON.stringify(getSolveScores(7, 'hard')), '[90]', 'existing history unchanged');

// A PARTLY filled history is topped up, not skipped: the device played a few
// games after the history shipped but has older solves that only the top list
// remembers. Leaving it alone is what made the win card say "besser als 100 %
// deiner 7 Partien" directly above a sixteen-entry list with a better time in it.
localStorage.clear();
for (const s of [24, 68, 82, 160]) {
  saveLocalScore(12, 'hard', { name: 'Ich', seconds: s, hints: 0, mistakes: 0, score: s });
}
for (const s of [82, 68, 280]) recordSolve(12, 'hard', s); // 280 fell off the old 10-entry list
{
  eq(seedSolveHistory(), 1, 'the partly filled bucket is topped up');
  eq(
    JSON.stringify(getSolveScores(12, 'hard')),
    '[24,160,82,68,280]',
    'only the solves the history was missing are added'
  );
  eq(seedSolveHistory(), 0, 'topping up again does nothing (idempotent)');

  // And the card now agrees with the list underneath it.
  const st = getPersonalStats(12, 'hard', 26);
  eq(st.total, 5, 'every known solve counts, each exactly once');
  eq(st.rank, 2, 'ranked behind the 24 the list shows on top');
  eq(st.percentile, 80, 'beats four of five');
  eq(st.bestScore, 24, 'best still comes from the merged picture');
}

// Nothing to seed from at all.
localStorage.clear();
eq(seedSolveHistory(), 0, 'no top lists → nothing seeded');

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
