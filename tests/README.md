# Tests

Developer aids for verifying logic and behaviour changes. **This is not CI** —
nothing runs these automatically, and the project still ships with **no build
step and no dependencies** (see `../CLAUDE.md`). They're here so a later session
doesn't have to re-derive how to drive this game from scratch.

Three kinds, split by what they need:

## `logic/` — pure Node, no browser, no dependencies

The rules/solver/generator/hint/game modules have **no DOM access**, so they run
directly under Node. These are the robust, portable checks — run them after any
change to `js/solver.js`, `js/generator.js`, `js/hint.js`, or `js/game.js`.

```bash
node tests/logic/hint-solve.mjs
```

`hint-solve.mjs` is the smoke test `CLAUDE.md` describes: it generates puzzles
across sizes/difficulties and solves each one **purely by applying `computeHint`
repeatedly**, asserting all `N` queens land on the unique solution. If the
generator, solver and hint engine ever drift apart, the solve stalls and the
test fails — which is exactly the regression you want to catch.

`leaderboard-retry.mjs` covers the online-submit retry logic in
`js/leaderboard.js` with a **mocked `fetch`** — so it never writes to the real
Supabase leaderboard. It asserts `submitScore` retries transient failures
(network / 5xx / 429) with backoff, does *not* retry a permanent 4xx, and gives
up after a bounded number of attempts. It exercises the real backoff schedule,
so it takes a few seconds.

`leaderboard-period.mjs` covers the read half of `js/leaderboard.js`, also with a
mocked `fetch`: that a windowed read sends `p_since` while an all-time read sends
none (an un-migrated database has no such parameter and would 404), that
`created_at` becomes `at` and its absence reads as undated, and that every
time-scoped call fails soft to `null` — which is what silently hides the period
tab rather than breaking the modal.

`player-rank.mjs` covers `fetchPlayerRank` — the read behind "Platz 3 von 3
Spielern" instead of "Platz 28 von 83" — with the same mocked `fetch`. The happy
path is the small half of it: what matters is that a wrong answer becomes **no**
answer, because the status line falls back to the entry-based sentence whenever
this resolves `null`, and that fallback is all that stands between a malformed
row and a placement shown to the player that nothing supports. So every way of
not knowing is enumerated (404 for an un-migrated database, 4xx, 5xx, offline, an
empty array, a rank outside `1..total`, a non-numeric rank), plus the two
contract details the SQL depends on: an absent name goes out as `''` and never
`null`, and a missing `is_best` reads as *true* so "not your best" is never
claimed without the server saying so.

It ends with the check `verify-i18n.mjs` structurally cannot do. A rank among
players carries a **counted noun**, which none of the previous submit copy did
("Platz 3 von 83" needs no grammar) — identical key sets and matching parameters
would happily let a pack print "von 1 Spielern". Each pack is therefore rendered
at the totals where its own plural switches: 1 vs 5 for the five Latin packs, and
1/2/5/21 for Russian, whose three forms repeat modulo 100.

`percentile.mjs` covers the relative-feedback half of `js/highscores.js` — the
solve history, `percentileBetter` / `globalPercentile` (ties count half, and the
rounding never claims a flat 0/100 unless the score really beat none/all),
`getPersonalStats`, the `seedSolveHistory` backfill with its `mergeSolveSamples`
multiset union (idempotent; the reason a pre-history device doesn't report "von 0
Partien", that a partly filled history is topped up rather than skipped, and that
a solve sitting in *both* stores is still counted once), the dated storage format
with its rolling window, and the two places that decide where an equal result
lands: `previewRank` (a tie doesn't overtake, and the preview agrees with what
saving does) and `matchOwnEntry` (of several identical rows, the newest is ours —
marking the first one is what outlined the wrong row after a submit). It installs
a small in-memory `localStorage` stand-in, so it stays pure Node.

`verify-i18n.mjs` is the guard that makes adding a language safe. It can't judge
a translation, but it checks everything mechanical: that every pack in `js/i18n/`
carries exactly the fallback's key set (nothing missing, nothing dead), that a key
is a string in every pack or a function in every pack (a template silently turned
into a plain string would swallow its parameters), that every template runs and
returns a non-empty string, that a translation still *uses* every parameter the
fallback uses — dropping `{rank}` loses the information the sentence was built to
carry — and that every key referenced from `index.html` or from a literal `t('…')`
in `js/` actually exists. Pure Node, so CI runs it on every push.

`qr-code.mjs` covers the share QR code. The encoder lives in
`tools/generate-qr.mjs` (dev-only; the app itself ships no generator, just the
finished SVG in `index.html`), and a broken QR is invisible — it still looks like
a QR code — so this test **decodes** rather than eyeballs: it reads the finished
module matrix back the way a scanner does (unmask, lift the format bits,
de-interleave the blocks, read the byte segment) with no code path shared with
the encoder, across several ECC levels and versions. Then it asserts `index.html`
embeds exactly the code the encoder produces for the live address, and that the
link printed under the code says the same thing. Pure Node, so CI runs it.

`voice-parse.mjs` covers `parseVoiceCommand` in `js/voice.js` — the pure German
transcript → command parser behind Voice Mode. It checks the chess-style
coordinate mapping (letter=column, number=row, e.g. "C4"), the German spelling
alphabet + spoken number words, the cell-action verbs (Dame/Punkt/leeren),
out-of-range rejection, the global actions, and that `stopp` always wins. Pure
logic — `voice.js` only touches `window` inside its recogniser wrapper, never at
import time.

`stats.mjs` covers `js/stats.js`, the anonymous play counters. Two properties
carry the feature: `statsSource` must tag an automated run as `test` (it reads
`navigator.webdriver`, checked *before* the hostname, so a Playwright run against
localhost is test traffic and not dev traffic) and must fail **closed** — an
environment it cannot place is never `web`. The other is agreement with the
server: `bump_stat` drops unknown kinds and sources *silently*, so a value added
on one side only would look exactly like a working feature that counts nothing.
The test therefore reads the accepted lists straight out of
`docs/leaderboard-setup.sql` and compares them. A mocked `fetch` covers the rest:
four fields and nothing identifying in the payload, nothing sent for an unknown
kind, and no failure — not even a synchronous throw — reaching the caller.

`weekly-report.mjs` covers `tools/weekly-report.mjs`, the deterministic weekly
activity report (`docs/weekly-report.md`). Plain arrays in, markdown out — no
network. Besides the arithmetic (window boundaries, the record comparison
following `top_scores`' ordering, the new/returning name split, device-days) it
pins the two properties that would rot silently: the `client_key` hash — the
daily salted IP hash — must never appear in the rendered text, and the output
must not change when the host time zone does. The second check flips
`process.env.TZ` to UTC+14 and re-renders; a stray `toLocaleString` or a
local-time `getDate()` would regroup the days and fail it.

## `sql/` — a throwaway local Postgres

`rank-order.sql` is the only test that touches the *server* half of the
leaderboard. It applies `docs/leaderboard-setup.sql` to a scratch database and
checks that `submit_score`'s reported rank equals the row's actual position in
`top_scores` — for nine submits full of collisions (two players on one score, the
same solve submitted twice, a tie on the worst score). That agreement is what the
win screen's `.me` highlight and its status line both depend on, and the one case
where they used to disagree — an exact tie — put the green outline on the row
*above* the entry just submitted. It also checks `score_counts` against the
windowed list and that re-running the setup file leaves existing rows alone.

⚠ It **truncates `public.scores`** — throwaway database only, never the live
project. The file's header carries the initdb/pg_ctl commands. Nothing runs it
automatically: there is no Postgres in CI, exactly like there is no Playwright.

`player-rank.sql` covers `player_rank` (section 5c) on the same scratch database.
It builds the real shape of the live board — ten entries belonging to three
players — and checks that the single newcomer reads as *third of three* rather
than eighth of ten, while `top_scores` still returns all ten rows. Then the ways
the player key can go wrong: case and whitespace normalise, but **empty names
never merge** (three anonymous rows are three players, not one shared account),
a tie between two players gives them *different* places with the older in front,
and an unknown player yields no row at all instead of a guess.

Two blocks cover regressions found in review, each reproduced against a real
database before it was fixed. A player may legitimately call themselves
`row:17`, which under the first draft's text-prefix key merged them with the
anonymous row of id 17 — one player vanished from `total` and the anonymous
player's best time was reported as the named player's. And two anonymous clients
submitting the same score seconds apart used to be told apart by recency, so the
one that asked first could be handed the other's rank; they now carry their
`submission_id`. The block also pins the legacy path (no id → the old heuristic,
still reachable by an older client) so it can't change unnoticed. It closes with an
independent cross-check — the rank must equal the position a window function
gives the same row, derived without sharing any code with the function, the way
`logic/qr-code.mjs` decodes the QR matrix rather than re-encoding it.

Same throwaway-database rules as `rank-order.sql`; it TRUNCATES `public.scores`.

`play-stats.sql` covers the counter half of the server: that only valid bumps
land (invalid ones are dropped silently by design — nothing else would notice a
regression), that `web`, `test` and `dev` stay in separate rows instead of
separate numbers, that `anon` may bump but may not read, that the 60-per-minute
rate limit bites, and that re-running the setup file leaves the counters alone.
Same throwaway-database rules as `rank-order.sql`; it TRUNCATES `play_stats` and
`stat_limits`.

## `browser/` — Playwright, environment-provided

These drive the real DOM (`js/main.js`) in Chromium. Use them for interaction
and rendering behaviour that pure logic can't cover.

**Important:** Playwright and Chromium here come from the **execution
environment**, not this repo — there is no `package.json` and these tests use
fixed paths (`/opt/node22/...`, `/opt/pw-browsers/chromium`). They only run in
that kind of environment. `board-helpers.mjs` documents and encapsulates the
quirks (module import shape, pointer capture on the board, the tap cycle where
an auto-marked cell reaches a queen in one tap).

The app is ES modules **plus a Web Worker**, so it can't load over `file://` —
serve it over HTTP first:

```bash
python3 -m http.server 8000 &          # serve the repo root
node tests/browser/error-delay.mjs      # BASE_URL defaults to http://localhost:8000
```

**Every browser test must stub the play counters.** `openGame()` does it for
you; a test that builds its own page with `browser.newPage()` calls
`stubStats(page)` from `board-helpers.mjs` right after. Same reason the
leaderboard RPCs are stubbed — a test must not write to the live project — with
one extra wrinkle: on a server where the counter migration hasn't run, the ping
404s, and that lands in the collected `errors` as console noise the test would
then have to tolerate. Pass `stats: 'live'` to `openGame` (or register your own
route afterwards) when observing the pings is the point of the test.

`error-delay.mjs` asserts that board error feedback (conflict + dead-unit
marks) stays hidden the instant a queen is placed and only appears after the
delay — so an immediate reaction can't reveal a queen's position.

`leaderboard-retry.mjs` drives a real solve (via hints) to the win screen and
checks the global-submit flow: it **intercepts every Supabase RPC with
`page.route`** — so no test score ever reaches the live leaderboard — fails the
submit endpoint to drive the auto-retry + manual *"Erneut versuchen"* path, then
lets it succeed and verifies the same solve can't be submitted twice
(`pendingWin.submittedGlobal`). Slow by design (it waits out the real backoff).

`win-feedback.mjs` covers the win screen's relative feedback, also with **every
Supabase RPC mocked via `page.route`**. It seeds the "played before the solve
history existed" state (full top list, no history) and checks the boot backfill
makes the personal line compare against those games; that the global tab
highlights nothing before a submit but explains the absence in the status line;
that after a submit the player's own row carries the `.me` highlight (found by
value, not by rank index) and the status reports the share beaten; that a row
carrying **exactly our values** but submitted earlier does not steal that
highlight — the tie case, where marking by the server's rank outlined the row
above the fresh entry; that every row shows its age and the fresh one reads
"jetzt"; that the rolling-window line appears on a second solve; and that the
debug-only copy button on the win card exports the scoring + percentile inputs.
It also pins the **layout** guarantees around a 50-entry list: the list scrolls
instead of stretching the card, only a handful of rows show at once, the card stays
clear of the top bar, and the own row is scrolled into the visible box. That part
runs at **375×667** on purpose — the short-phone case, where the card used to cover
the header.

Both this and `leaderboard-retry.mjs` drive the solve with a hint loop that checks
`#hint-card` (not just `#hint-apply`) before clicking: the apply button keeps its
own `hidden` state from the previous hint, so a card that failed to open reads as
clickable and Playwright then waits out a full 30 s timeout. A JS error inside
`onWin` looks exactly like that, so the helper throws with the collected page
errors instead of hanging — which is how an unimported constant was found.

`hint-cost.mjs` covers the hint surcharge becoming visible: the price tag baked
into the hint button's label, the "+30 s" pill that flies off it, the live clock
taking the 30 s, and the timer pulse that ties the two together. The assertion
that earns the file is the **negative** one: `hintsUsed` only bumps for a *new*
deduction (`seenHints`), so re-opening the same hint must move neither the clock
nor the pill — an animation wired to the click instead of to that branch would
charge the player for something the score doesn't. It then solves by hints and
closes the arithmetic on the win card (effective time = playing time + 30 s per
hint, charged exactly once, and the frozen clock reads exactly the result) —
which is what would catch the penalty being folded into `currentElapsed()`
instead of `renderTime()`. Finally it measures the grown label at 320/375/430px
portrait and in the fixed-width landscape button column, where `.btn` is
`white-space: nowrap` and an overlong label paints over its neighbour silently.

`reset-timer.mjs` guards the one thing "Zurücksetzen" must *not* do: start a new
attempt. Clearing the board used to run `startTimer()`, which zeroed the clock
and the hint/mistake counters — so a player could solve a board almost to the
end, memorise the queens, reset, and replay the solution against a clock at 0:00
for an unbeatable score. The test measures the clock across a reset (it must not
rewind, and must keep ticking), that the board is still actually cleared and the
reset still undoable, that the hint surcharge survives on the clock, and that a
repeat of the same hint after a reset is still *free* (`seenHints` has to survive
as well, or the reset overcharges instead of undercharging). It then closes the
loop on the figure that actually matters — the **recorded score**: it solves the
board from the solution (read out of the debug export, so the solve itself spends
no hints) and checks the win card's playing time and score against readings taken
*before* the first reset.

That last anchor is the point of the file, and it is deliberately a **time**, not
a count: with the bug back the reset clears `seenHints` too, the repeat hint is
charged afresh, and the card still reports "1 Tipp" — the right number for the
wrong reason. Only the clock discriminates, and only a reading from before the
first reset can, since a later one is already zeroed on a broken build. The
mistake counter (no penalty, but it is displayed) is pinned the same way, with a
queen placed deliberately off the solution.

The fix was a subtraction, so nothing else in the app notices if a refactor
routes reset back through `startTimer()`.

`leaderboard-period.mjs` covers the adaptive period tab in the Bestenliste,
bucket by bucket, with `score_counts` and `top_scores` both mocked: offered where
the window holds a field, hidden where it holds almost nothing, hidden where
*everything* is inside it (the tab would be a copy of the global list), and hidden
against a server that answers 404 because the SQL was never re-run. It also
measures the three-tab row at 390/360/320px — three tabs plus "Global 🌐" is the
tightest label row in the app.

`player-rank.mjs` (browser) covers the two surfaces the player-level rank shows
up on. First the renamed on-device tab — "Eigene" / "Mine" / "Perso" / "Míos" /
"Meus" / "Мои" — measured in all six languages at 390/360/320px with the third
tab forced up, because the row is only tight when all three are shown and a
two-tab measurement would happily pass a label that cannot fit. It refuses to
measure without that third tab for exactly that reason. The surprise the
measurement produced: **390px is the worst case, not 320px** — below 380px a
media query shrinks the font, so a 390px phone renders the full-size label in a
still-narrow box. Second, the own-row highlight in the Bestenliste modal: exactly
one row marked, it is the player's *best* row rather than any of theirs, the
nickname matches case-insensitively, and an empty nickname marks nothing at all.

`i18n-layout.mjs` is the layout half of the i18n guard — `logic/verify-i18n.mjs`
checks that the packs *match*, this one checks that they *fit*. It walks every
language: the top bar at seven widths (320–640), then every pack value rendered
with realistic parameters into the real element it appears in (hint card, win
card, party overlay, status line), plus the live board/settings/leaderboard/QR-share
surfaces and `<html lang>`.

Every Supabase RPC is answered locally via `page.route` (through `openGame`'s
`routes` hook — the app fires its leaderboard reads on boot, before a test could
attach one afterwards), so the run never touches the live project. The stub also
pins `score_counts` to a bucket that is busy all-time but only partly recent,
which is what makes the **period tab** appear: without it the three-tab row — the
tightest label line in the app — would simply be absent from the measurement.
That is not theoretical, it is how Russian's "Локально"/"Глобально 🌐" were caught
overflowing a 95px tab and shortened to "Моя"/"Общая 🌐". One route handler
dispatches on the URL rather than one per RPC plus a catch-all, because Playwright
checks handlers in **reverse** registration order and a catch-all added last
silently swallows the specific ones.

It asserts on **element** geometry, never the page's, and that distinction is the
whole point: `<body>` has `overflow-x: clip`, so a row that stops fitting
produces no scrollbar, and `.brand` is a column flex with
`align-items: flex-start`, which lets children spill past the column instead of
shrinking with it. Together those hid a real collision — the `<h1>` kept its full
width inside a squeezed `.brand` and painted "Queens" underneath the toolbar
buttons. German had been shaving the "s" off since the packs landed and no test
noticed; French made it a 35px overlap. Wrapping to a second line is a **pass**,
not a failure: below ~360px the row doesn't fit in any language, English
included.

`voice-mode.mjs` drives Voice Mode end-to-end through the real DOM. There's no
microphone here, so it **injects a fake `SpeechRecognition`** (via
`addInitScript`) and pushes transcripts at it with `window.__fakeVoice.emitFinal`
— exercising the whole path a real utterance would (recogniser →
`parseVoiceCommand` → the same internal calls a tap/button makes → the board).
It enables the mode through the settings UI, places/clears a queen by voice,
opens a hint, stops on "stopp", and confirms the feature gates itself off in a
browser without the Web Speech API.

### Writing a new browser test

Import the helpers and let them handle the fiddly parts:

```js
import { openGame, boardSize, cellIndex, placeQueen, conflictCount } from './board-helpers.mjs';

const { browser, page, errors } = await openGame();
// ... drive the board, assert, then:
await browser.close();
```

Always assert `errors` (collected console/page errors) stays empty, and test at
a phone-sized viewport — this is a touch-first game.

**Pin the locale if you assert on visible text.** The UI language now follows the
browser on a first visit (see `js/i18n.js`), so an unpinned test reads whatever
language the host happens to be in. `openGame({ locale: 'de-DE' })` (or
`newPage({ viewport, locale })` for the tests that build their own page) fixes it;
`openGame` also takes `{ storage }` to seed `localStorage` before boot. Tests
asserting German copy — `live-check-sticky.mjs`, `leaderboard-retry.mjs`,
`win-feedback.mjs` — pin `de-DE` for that reason, and `voice-mode.mjs` *must*:
Voice Mode is gated to the German UI, so the switch is disabled otherwise and
nothing below it runs.

`qr-share.mjs` drives the QR share dialog: that the button really sits in the
settings' title row (right edge, level with the heading, a full-size touch
target), that the dialog *layers* on the settings — they stay open behind it, so
Escape and a backdrop tap close the code only and the second press closes the
settings — that the code renders large enough to scan and the card fits a phone
screen, and that the link under it points at the shared address. What the code
*encodes* is `logic/qr-code.mjs`'s job.

`blocky-style.mjs` covers the `blocky` region-growth style in `js/generator.js`
(see `../CLAUDE.md` → "Region-growth styles"). It generates blocky boards across
sizes/difficulties and asserts the invariants that matter regardless of how a
board *looks*: every region contiguous and non-empty, exactly one solution, a
rating the hint engine can explain (never level 3), hint-solvable end to end,
and — above easy — no single-cell region and no board that falls out of naked
singles alone. That last pair is the regression to fear: the uniqueness repair
moves cells *out* of regions, so without its `minSize` guard it quietly undoes
the size floor the style depends on.

`strips-style.mjs` is its counterpart for the `strips` style (same CLAUDE.md
section). It asserts the same invariants plus the one the style *is*: exactly
`N-1` regions are straight one-cell-wide segments and the one that isn't is the
biggest. That is the regression to fear here — `makeUnique`, the repair the other
two styles use, bends a segment into an L to buy uniqueness, so a refactor
routing strips back through it would still produce valid, unique, fair boards
that have quietly stopped looking like the style. It also pins that asking for
`easy` returns a board rated one level up rather than a mislabelled easy one:
strips has no easy boards by construction. Both files share their board checks
via `lib/board-checks.mjs`; `hint-solve.mjs` keeps its own drive loop on purpose
(it is the CI smoke test and is written to read as "this is what a player does").

`board-size-hint.mjs` covers the board-size rule: every size is pickable on every
screen, and the settings say how small a cell would render rather than deciding
for the player. It checks the slider reaches `MAX_SIZE` on a phone, that the hint
appears exactly when the measured cell size is below the threshold (and quotes
that figure), that it follows a resize, that it fits its card in the two longest
languages — and, at the end, the measurement the whole rule rests on: a 14x14 on
a 390x844 phone lays out with no overflow, nothing under the top bar, nothing cut
off, and a single tap marks exactly one cell. An earlier version of this feature
capped the slider instead; that last check is what says the cap wasn't protecting
anything.
