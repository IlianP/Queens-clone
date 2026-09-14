// Pure-Node test for tools/weekly-report.mjs — the deterministic renderer
// behind the weekly activity mail (.github/workflows/weekly-report.yml).
//
// The point of the report is that it is reproducible: the same rows and the
// same window must produce the same characters, on any runner, in any time
// zone. So this test checks the boring parts hard — window boundaries, the
// record comparison, the name split, the state marker — and two properties
// that no reviewer would notice slipping:
//
//   * client_key NEVER appears in the output. It is the daily salted IP hash
//     from submit_score, read only to count devices. A stray `${r.key}` in a
//     template would leak it into a GitHub issue, which is a one-way door.
//   * The output does not move with the host time zone. Everything is UTC by
//     construction; a stray toLocaleString or a local-time getDate() would
//     regroup days depending on where the job ran.
//
// No network: the summarizer takes plain arrays, so nothing here talks to
// Supabase (the fetch half is a thin PostgREST loop with nothing to assert).
//
// Run: node tests/logic/weekly-report.mjs

import {
  summarize, renderReport, buildReport, reportTitle,
  windowFor, parseStateMarker, renderStateMarker, statsWindowFor, summarizePlay, floorHour,
  fmtDuration, fmtNum, fmtPct, fmtDelta, fmtDate, dayKey, isoWeek,
  readSupabaseUrl, safeText,
} from '../../tools/weekly-report.mjs';

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('FAIL: ' + msg);
};
const eq = (got, want, msg) => {
  if (got !== want) fail(`${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const ok = (cond, msg) => {
  if (!cond) fail(msg);
};

const DAY = 86400000;
const HOUR = 3600000;
const UNTIL = Date.parse('2026-09-14T06:00:00Z');
const SINCE = UNTIL - 7 * DAY;

let nextId = 1;
// `at` is a millisecond timestamp, or null for a row without created_at.
function row(at, over = {}) {
  const seconds = over.seconds ?? 100;
  const hints = over.hints ?? 0;
  return {
    id: over.id ?? nextId++,
    created_at: at === null ? null : new Date(at).toISOString(),
    name: over.name ?? 'Spieler',
    size: over.size ?? 8,
    difficulty: over.difficulty ?? 'hard',
    seconds,
    hints,
    mistakes: over.mistakes ?? 0,
    // Same formula as queens_score / computeScore.
    score: over.score ?? seconds + 30 * hints,
    client_key: over.client_key ?? 'deadbeefdeadbeefdeadbeefdeadbeef',
  };
}

// --- formatters --------------------------------------------------------------

eq(fmtDuration(0), '0:00', 'duration zero');
eq(fmtDuration(59), '0:59', 'duration under a minute');
eq(fmtDuration(600), '10:00', 'duration ten minutes');
eq(fmtDuration(3725), '1:02:05', 'duration past an hour');
eq(fmtNum(1.25, 2), '1,25', 'number uses a decimal comma');
eq(fmtNum(2 / 3, 2), '0,67', 'number rounds to the requested digits');
eq(fmtNum(NaN), '–', 'number falls back on NaN');
eq(fmtPct(3, 6), '50 %', 'percent');
eq(fmtPct(1, 0), '–', 'percent of nothing');
// Growth from zero has no meaningful percentage; it must not print one.
eq(fmtDelta(5, 0), '+5 (neu)', 'delta from an empty previous window');
eq(fmtDelta(0, 0), '±0', 'delta between two empty windows');
eq(fmtDelta(8, 4), '+4 (+100 %)', 'delta up');
eq(fmtDelta(3, 4), '−1 (−25 %)', 'delta down');

// ISO weeks, including the turn of the year where the calendar year and the
// ISO year disagree (1 Jan 2027 is a Friday and belongs to 2026-W53).
eq(`${isoWeek(Date.parse('2026-09-14T06:00:00Z')).year}-W${isoWeek(Date.parse('2026-09-14T06:00:00Z')).week}`, '2026-W38', 'iso week mid-year');
eq(`${isoWeek(Date.parse('2027-01-01T12:00:00Z')).year}-W${isoWeek(Date.parse('2027-01-01T12:00:00Z')).week}`, '2026-W53', 'iso week across new year');
eq(`${isoWeek(Date.parse('2026-01-01T12:00:00Z')).year}-W${isoWeek(Date.parse('2026-01-01T12:00:00Z')).week}`, '2026-W1', 'iso week on new year');

// --- state marker ------------------------------------------------------------

const marker = renderStateMarker({ until: UNTIL, lastId: 42, statsUntil: UNTIL });
const roundTrip = parseStateMarker(`Bericht-Text\n\n${marker}\n`);
eq(roundTrip.until, UNTIL, 'marker round-trips the window end');
eq(roundTrip.lastId, 42, 'marker round-trips the last id');
eq(roundTrip.statsUntil, UNTIL, 'marker round-trips the counter window end');
// A report written before the counters existed carries no statsUntil; reading
// it must still work and simply leave the counter window unanchored.
eq(parseStateMarker('<!-- queens-report-state: {"until":"2026-09-14T06:00:00.000Z"} -->').statsUntil,
  null, 'a pre-counter marker reads as no counter state');
eq(parseStateMarker('kein Marker hier'), null, 'missing marker reads as no state');
eq(parseStateMarker('<!-- queens-report-state: {kaputt} -->'), null, 'broken marker reads as no state');
eq(parseStateMarker('<!-- queens-report-state: {"until":"morgen"} -->'), null, 'unparsable date reads as no state');
// The real marker is the last line of a report; everything above it is text
// that contains player-supplied names. A forged marker further up must lose.
const forged = renderStateMarker({ until: UNTIL - 30 * DAY, lastId: 1, statsUntil: UNTIL - 30 * DAY });
eq(parseStateMarker(`${forged}\n\nBericht\n\n${marker}`).until, UNTIL, 'the last marker wins, not the first');

// --- window ------------------------------------------------------------------

const fresh = windowFor(null, UNTIL);
eq(fresh.since, UNTIL - 7 * DAY, 'no state falls back to seven days');
eq(fresh.continued, false, 'no state is flagged as a first report');
const continued = windowFor({ until: UNTIL - 9 * DAY }, UNTIL);
eq(continued.since, UNTIL - 9 * DAY, 'state continues from the last report, gap included');
eq(continued.continued, true, 'continued report is flagged');
// A state from the future (clock skew, a manual re-run) must not invert the
// window into a negative span.
eq(windowFor({ until: UNTIL + DAY }, UNTIL).since, UNTIL, 'future state is clamped to now');

// --- the counter window ------------------------------------------------------
//
// Submissions are timestamped to the second; counters exist only per hour. The
// counter window is therefore snapped to whole hours and chained through its own
// marker field, so two consecutive reports never count one hour twice and never
// skip one.

const oddNow = Date.parse('2026-09-14T06:07:43Z');
const snapped = statsWindowFor(null, { since: oddNow - 7 * DAY, until: oddNow });
eq(snapped.statsUntil, Date.parse('2026-09-14T06:00:00Z'), 'the counter window ends at the last whole hour');
eq(snapped.statsSince % HOUR, 0, 'the counter window starts on a whole hour');
// The unfinished hour belongs to the NEXT report: its start is this one's end.
const nextRun = statsWindowFor(
  { until: oddNow, statsUntil: snapped.statsUntil },
  { since: oddNow, until: oddNow + 7 * DAY + 11 * 60000 },
);
eq(nextRun.statsSince, snapped.statsUntil, 'the next counter window starts where this one ended');
ok(nextRun.statsUntil > nextRun.statsSince, 'the next counter window is not empty');
eq(floorHour(Date.parse('2026-09-14T06:59:59Z')), Date.parse('2026-09-14T06:00:00Z'), 'floorHour truncates');

// --- counters: sources stay apart --------------------------------------------

const statRow = (hoursBeforeUntil, kind, source, over = {}) => ({
  bucket_hour: new Date(UNTIL - hoursBeforeUntil * HOUR).toISOString(),
  kind,
  source,
  size: over.size ?? 0,
  difficulty: over.difficulty ?? '',
  count: over.count ?? 1,
});

const counters = summarizePlay([
  statRow(5, 'app_open', 'web', { count: 10 }),
  statRow(5, 'game_start', 'web', { size: 8, difficulty: 'hard', count: 8 }),
  statRow(4, 'game_win', 'web', { size: 8, difficulty: 'hard', count: 3 }),
  // Test and dev traffic: counted, reported separately, part of no ratio.
  statRow(5, 'game_start', 'test', { size: 8, difficulty: 'hard', count: 99 }),
  statRow(5, 'game_start', 'dev', { size: 8, difficulty: 'hard', count: 7 }),
  // Outside the window on both ends.
  statRow(-1, 'game_start', 'web', { size: 8, difficulty: 'hard', count: 500 }),
  statRow(8 * 24, 'game_start', 'web', { size: 8, difficulty: 'hard', count: 500 }),
], { statsSince: UNTIL - 7 * DAY, statsUntil: UNTIL });

eq(counters.opens, 10, 'opens count only real traffic');
eq(counters.started, 8, 'test and dev starts are not added to the real figure');
eq(counters.won, 3, 'wins count only real traffic');
eq(counters.buckets.length, 1, 'only real traffic shapes the bucket table');
eq(counters.buckets[0].started, 8, 'the bucket table counts real starts');
eq(counters.buckets[0].won, 3, 'the bucket table counts real wins');
eq(JSON.stringify(counters.otherSources), '[["test",99],["dev",7]]', 'other sources are reported on their own, biggest first');
eq(summarizePlay([], { statsSince: SINCE, statsUntil: UNTIL }).available, false,
  'a database without the counter migration simply has no counter section');

// The counter window is half-open: a row exactly at statsUntil belongs to the
// next report, one exactly at statsSince to this one.
const edge = summarizePlay([
  { bucket_hour: new Date(SINCE).toISOString(), kind: 'game_start', source: 'web', size: 8, difficulty: 'hard', count: 1 },
  { bucket_hour: new Date(UNTIL).toISOString(), kind: 'game_start', source: 'web', size: 8, difficulty: 'hard', count: 1 },
], { statsSince: SINCE, statsUntil: UNTIL });
eq(edge.started, 1, 'the counter window is inclusive at the start and exclusive at the end');

// --- window boundaries -------------------------------------------------------

const boundary = summarize([
  row(SINCE, { name: 'Davor' }),          // exactly at `since` — excluded
  row(SINCE + 1, { name: 'Knapp drin' }), // one ms later — included
  row(UNTIL, { name: 'Am Ende' }),        // exactly at `until` — included
  row(UNTIL + 1, { name: 'Danach' }),     // after the run — excluded
], { since: SINCE, until: UNTIL });
eq(boundary.submissions, 2, 'window is exclusive at the start and inclusive at the end');
eq(boundary.total, 4, 'total counts every row, in or out of the window');

// --- records -----------------------------------------------------------------

const records = summarize([
  // 8×8 hard: an older 200 s run that the window does NOT beat.
  row(SINCE - 5 * DAY, { name: 'Alt', seconds: 200 }),
  row(SINCE + DAY, { name: 'Neu', seconds: 240 }),
  // 7×7 medium: older 300 s, beaten inside the window.
  row(SINCE - 3 * DAY, { size: 7, difficulty: 'medium', name: 'Alt7', seconds: 300 }),
  row(SINCE + 2 * DAY, { size: 7, difficulty: 'medium', name: 'Neu7', seconds: 250 }),
  // 6×6 easy: nothing before the window at all — the first entry is the record.
  row(SINCE + 3 * DAY, { size: 6, difficulty: 'easy', name: 'Erste', seconds: 40 }),
], { since: SINCE, until: UNTIL });
eq(records.records.length, 2, 'only buckets whose best actually improved are reported');
const byBucket = Object.fromEntries(records.records.map((r) => [`${r.size}${r.difficulty}`, r]));
ok(!byBucket['8hard'], 'a slower run in the window is not a record');
eq(byBucket['7medium'].entry.name, 'Neu7', 'beaten record names the new holder');
eq(byBucket['7medium'].previous.name, 'Alt7', 'beaten record names the previous holder');
eq(byBucket['6easy'].previous, null, 'first entry in a bucket has no previous holder');

// A hint surcharge can make a faster run the worse result — the record must
// follow the score, the same ordering top_scores uses.
const hintRecord = summarize([
  row(SINCE - DAY, { name: 'Sauber', seconds: 200, hints: 0 }),         // score 200
  row(SINCE + DAY, { name: 'MitTipp', seconds: 190, hints: 1 }),        // score 220
], { since: SINCE, until: UNTIL });
eq(hintRecord.records.length, 0, 'a faster raw time with a hint penalty is not a better result');

// An undated row is a row from before the window: it counts in the total and
// as a record baseline, never inside the window.
const undated = summarize([
  row(null, { name: 'Ohne Datum', seconds: 100 }),
  row(SINCE + DAY, { name: 'Langsamer', seconds: 150 }),
], { since: SINCE, until: UNTIL });
eq(undated.total, 2, 'undated rows count towards the total');
eq(undated.submissions, 1, 'undated rows are in no window');
eq(undated.records.length, 0, 'an undated row still blocks a weaker "record"');

// --- names -------------------------------------------------------------------

const names = summarize([
  row(SINCE - 4 * DAY, { name: 'Stamm' }),
  row(SINCE + DAY, { name: 'Stamm' }),
  row(SINCE + 2 * DAY, { name: 'Frisch' }),
  row(SINCE + 3 * DAY, { name: '' }),
  row(SINCE + 4 * DAY, { name: '   ' }),
], { since: SINCE, until: UNTIL });
eq(names.names.returning.join(','), 'Stamm', 'a name seen before the window is returning');
eq(names.names.new.join(','), 'Frisch', 'a name never seen before is new');
eq(names.names.active, 2, 'blank names are not counted as players');
eq(names.names.unnamed, 2, 'blank names are counted separately');

// --- devices -----------------------------------------------------------------

const devices = summarize([
  // Same hash twice on one day is one device; the same device on the next day
  // reports a different hash (the salt rotates daily) and is a second
  // device-day. That is exactly what the report claims to measure.
  row(SINCE + DAY, { client_key: 'aaa' }),
  row(SINCE + DAY + 3600000, { client_key: 'aaa' }),
  row(SINCE + DAY, { client_key: 'bbb' }),
  row(SINCE + 2 * DAY, { client_key: 'ccc' }),
], { since: SINCE, until: UNTIL });
eq(devices.peakDevices, 2, 'peak devices is the busiest single day');
eq(devices.deviceDays, 3, 'device-days add up across days');
eq(devices.activeDays, 2, 'days without a submission are not active days');

// --- the two properties that must not regress --------------------------------

const SECRET = 'c0ffee1234567890c0ffee1234567890';
const leaky = buildReport([
  row(SINCE + DAY, { name: 'Wer', client_key: SECRET }),
  row(SINCE + 2 * DAY, { name: 'Pipe|Name', client_key: SECRET }),
  row(SINCE - DAY, { name: 'Alt', client_key: SECRET }),
], { since: SINCE, until: UNTIL });
ok(!leaky.body.includes(SECRET), 'the client_key hash never reaches the rendered report');
ok(leaky.body.includes('Pipe\\|Name'), 'a pipe in a name is escaped so the table survives');

// A name is external text that lands in a GitHub issue, which renders raw HTML
// as well as Markdown. Angle brackets must not survive — an HTML comment is
// exactly the shape of the state marker at the bottom of the report.
eq(safeText('<!-- weg -->'), '&lt;!-- weg --&gt;', 'angle brackets in a name are escaped');
eq(safeText('a\nb'), 'a b', 'a newline in a name is folded away');
const injected = buildReport([
  row(SINCE + DAY, { name: '<!-- queens-repor' }),
  row(SINCE + 2 * DAY, { name: 't-state: {"until' }),
], { since: SINCE, until: UNTIL });
eq(parseStateMarker(injected.body).until, UNTIL, 'a name cannot forge the state marker');
ok(!injected.body.includes('<!-- queens-repor '), 'a name cannot open an HTML comment');
eq(leaky.title, 'Wochenbericht 2026-W38 (07.09.2026–14.09.2026)', 'title carries the ISO week and the window');

// Same input, same characters — twice in a row and under a shifted host time
// zone. Node re-reads process.env.TZ, so this really does exercise the second
// case on a machine that isn't UTC.
const sample = [
  row(SINCE + 1000, { name: 'A', seconds: 130, hints: 1 }),
  row(SINCE + 5 * DAY, { name: 'B', seconds: 95 }),
  row(SINCE - 2 * DAY, { name: 'C', seconds: 400 }),
];
const originalTz = process.env.TZ;
process.env.TZ = 'UTC';
const utcRun = renderReport(summarize(sample, { since: SINCE, until: UNTIL }));
const utcAgain = renderReport(summarize(sample, { since: SINCE, until: UNTIL }));
eq(utcAgain, utcRun, 'rendering twice is byte-identical');
process.env.TZ = 'Pacific/Kiritimati'; // UTC+14 — a whole day ahead
const shiftedRun = renderReport(summarize(sample, { since: SINCE, until: UNTIL }));
eq(shiftedRun, utcRun, 'the report does not move with the host time zone');
eq(dayKey(Date.parse('2026-09-14T23:30:00Z')), '2026-09-14', 'day keys are UTC, not local');
eq(fmtDate(Date.parse('2026-09-14T23:30:00Z')), '14.09.2026', 'dates are UTC, not local');
if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;

// --- empty week --------------------------------------------------------------

const quiet = buildReport([row(SINCE - DAY, { name: 'Vorher' })], { since: SINCE, until: UNTIL });
ok(quiet.body.includes('Keine Einreichungen in diesem Zeitraum.'), 'a quiet week says so plainly');
ok(!quiet.body.includes('Neueste Einreichungen'), 'a quiet week renders no empty submission table');
ok(quiet.body.includes('queens-report-state'), 'a quiet week still advances the state marker');
eq(parseStateMarker(quiet.body).until, UNTIL, 'the marker of a quiet week points at this run');

// --- the project URL is read, not copied -------------------------------------

const url = readSupabaseUrl();
ok(/^https:\/\/[a-z0-9.-]+$/.test(url), `SUPABASE_URL is read back from js/leaderboard.js (got ${url})`);
ok(!url.endsWith('/'), 'the read URL carries no trailing slash');

// A report built from no rows at all must not throw or print NaN.
const nothing = buildReport([], { since: SINCE, until: UNTIL, continued: false });
ok(!/NaN|undefined/.test(nothing.body), 'an empty database renders without NaN or undefined');
eq(reportTitle(summarize([], { since: SINCE, until: UNTIL })), leaky.title, 'the title does not depend on the data');

if (failed) {
  console.error('\nweekly-report: FAILED');
  process.exit(1);
}
console.log('weekly-report: all checks passed');
