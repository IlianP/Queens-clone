# CLAUDE.md

Guidance for Claude Code when working in this repository. Keep this file
current when the architecture or workflow changes.

## What this is

A browser clone of the LinkedIn game **Queens**: a static site in plain
HTML/CSS/JavaScript with **no build step and no dependencies**. It uses native
ES modules and ships as-is to GitHub Pages. Player-facing text is **localised**
(English, German, French, Spanish, Portuguese, Russian — see "i18n" below) —
never hard-code a UI string, add a key to every language pack instead. Two
surfaces stay single-language on purpose: Voice Mode (German) and the debug
journal (German); both are documented below.
`README.md` is English, `README.de.md` the German original — keep them in step.

Live site: https://ilianp.github.io/Queens-clone/

## Rules of the game (the invariants all code upholds)

On an `N × N` board split into `N` contiguous colour regions, place `N` queens:
exactly one per **row**, one per **column**, one per **colour region**, and no
two queens may **touch** — not even diagonally (king-move adjacency). Every
generated puzzle has **exactly one solution** and is solvable by pure logic.

## Run it locally

ES modules don't load over `file://`, so serve over HTTP:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

There is **no linter or package.json** — the site ships with no build step and
no dependencies. There is, however, a small **developer test harness in
`tests/`**, and a minimal CI workflow (`.github/workflows/ci.yml`) runs the
`tests/logic/` half of it (`logic-tests` job) on every push and PR — see
"Git / workflow" below for how that gates merges to `main`. Check `tests/`
before re-deriving how to drive things:

- `tests/logic/` — pure Node, no browser, no deps. `node tests/logic/hint-solve.mjs`
  is exactly the smoke test below: solve generated puzzles end-to-end by applying
  `computeHint` repeatedly and assert all `N` queens land on the `solution`. Run
  it after any `solver.js` / `generator.js` / `hint.js` / `game.js` change.
- `tests/logic/strips-style.mjs` — the `strips` region-growth style: uniqueness,
  fairness (hint-solvable), contiguity, the size floor, and the invariant the
  style *is* — exactly one region is not a straight segment. Also that asking it
  for `easy` comes back honestly rated one level up rather than mislabelled. Run
  it after touching `growRegionsStrips` / `makeUniqueStrips` in `generator.js`.
  It shares its board checks with `blocky-style.mjs` via `tests/logic/lib/board-checks.mjs`.
- `tests/logic/leaderboard-period.mjs` — the read half of `leaderboard.js`: that a
  windowed read sends `p_since` and an all-time read does **not**, that
  `created_at` becomes `at` (and its absence reads as undated), and that every
  time-scoped call fails soft to `null`. Run it after touching `leaderboard.js`
  or `docs/leaderboard-setup.sql`.
- `tests/logic/stats.mjs` — the play counters in `js/stats.js`: every branch of
  `statsSource` (including that it fails **closed** — an environment it can't
  place is never `web`), that a ping carries four fields and nothing
  identifying, that an unknown kind is never sent, and that the allowed kinds
  and sources still match the lists `bump_stat` accepts — it reads them out of
  `docs/leaderboard-setup.sql`, because that function drops anything else
  *silently*. Run it after touching `js/stats.js` or that SQL block.
- `tests/logic/weekly-report.mjs` — the weekly activity report: window
  boundaries, the record comparison, the new/returning name split, the state
  marker, and the two properties nobody would notice regressing — that the
  `client_key` hash never reaches the rendered text, and that the output doesn't
  move with the host time zone. Run it after touching `tools/weekly-report.mjs`.
- `tests/logic/verify-i18n.mjs` — the i18n guard: identical key sets across packs,
  same value *types*, every template still uses the parameters the fallback uses,
  and every key referenced from `index.html` / `t('…')` exists. Run it after
  touching any UI string.
- `tests/sql/play-stats.sql` — the counter half of the server, against the same
  kind of **throwaway** local Postgres: that only valid bumps land (invalid ones
  are dropped silently by design, so nothing else would notice), that `web`,
  `test` and `dev` stay in separate rows, that `anon` may bump but may not read,
  that the 60-per-minute rate limit bites, and that re-running the setup file
  keeps the counters. Run it after any change to section 8 of that SQL file.
- `tests/sql/rank-order.sql` — the server half: applies
  `docs/leaderboard-setup.sql` to a **throwaway** local Postgres (it truncates
  `public.scores`, never point it at the live project) and asserts that
  `submit_score`'s rank equals the row's position in `top_scores` across nine
  colliding submits, that `score_counts` agrees with the windowed list, and that
  re-running the file keeps existing rows. The header carries the initdb
  commands. Run it after any change to that SQL file.
- `tests/browser/` — Playwright driving the real DOM. Playwright + Chromium are
  **environment-provided** (fixed `/opt` paths, no repo dependency), so these run
  only in that kind of environment. `board-helpers.mjs` encapsulates the fiddly
  parts (pointer capture on the board, the tap cycle). See `tests/README.md`.

To verify logic changes you can also run a module directly with Node (it's plain
ESM) and drive it with a real puzzle state — e.g. the debug JSON the game can
copy (⚙ → debug mode). A good smoke test for solver/hint changes is to solve a
puzzle end-to-end purely by applying `computeHint` repeatedly and asserting all
`N` queens land on the `solution`. Prefer this kind of behavioural check over
eyeballing the diff.

### Testing a branch on mobile (always offer this)

This is a visual, touch-first game, so **whenever proposing how to test a branch,
always include a way to test it on a phone** — don't only give localhost steps,
and don't make the user ask for it again. The established, working method:
bundle the branch into **one self-contained HTML file and publish it as an
Artifact**, then hand over the link (the user opens it on their phone before
creating/merging a PR).

Because the app is multi-file ESM **plus a Web Worker**, and an Artifact must be
a single self-contained file under a strict CSP, bundle it (don't hand-write a
copy) — the reproducible builder lives in git history for this branch
(`build-artifact.mjs`): it concatenates the real sources in dependency order
(`settings → audio → voice → solver → generator → levels → highscores → game →
hint → leaderboard → stats → main`, stripping `import`/`export` — the strip handles multi-line
imports and a post-strip guard throws if any survive), inlines the `levels/`
pools as the `__QUEENS_LEVELS__` global (the Artifact CSP blocks fetch, so the
online leaderboard is disabled in the Artifact and it runs local-only),
rebuilds the worker as a **classic Blob-URL worker** (module workers and
external URLs are CSP-blocked; the game's own fallback covers a sandbox that
blocks blob workers too), and **prepends `<meta charset="utf-8">`** so the
German text + emoji don't mojibake. Verify the bundle in a mobile-sized
Playwright viewport (Chromium at `/opt/pw-browsers`) before publishing.

`--style` defaults to `mixed` — the bundle then behaves exactly like the site,
because the shipped pools already hold both looks. `--style organic|blocky`
builds a **single-style trial** bundle instead: it embeds the
`levels/<N>-<difficulty>-<style>.json` pools under the plain keys `drawLevel`
looks up, and pins live generation by overriding `randomStyle()` in `main.js`
(every generation path routes through it). The override is guarded and throws if
that function moves, so a rename can't silently ship a mixed bundle under a
single-style name.

When driving the bundle with Playwright, wait for the intro reveal to finish
(`.board` loses `intro-revealing` *and* a cell has `data-state`) before reading
or tapping — `openGame` in `tests/browser/board-helpers.mjs` already does; a
fixed `waitForTimeout` after "Neues Spiel" does not, and reads back `undefined`.

## Architecture

Pure logic modules have **no DOM access**; `main.js` is the only file that
touches the DOM. Data model throughout: `region[r][c]` = region id, and a
puzzle solution is `cols[r]` = the column of the queen in row `r`.

| File | Role |
|------|------|
| `index.html` | Page skeleton |
| `css/styles.css` | Layout, responsive/mobile design |
| `js/solver.js` | Rules, unit lists, solution counting (uniqueness), human-style deduction solver + difficulty rating |
| `js/generator.js` | Generates puzzles with a guaranteed-unique solution at a target difficulty (runtime fallback + pool builds); three region-growth styles (`organic` / `blocky` / `strips`), see below — mixing is a *pool*-level concern, the generator only ever grows one style per call |
| `js/levels.js` | Serves precomputed puzzles from `levels/` with a random D4 rotation/mirror per draw; session shuffle-bag; `drawLevel` resolves `null` on any failure |
| `levels/` | Precomputed pools, one JSON per size × difficulty (built by `tools/generate-levels.mjs`, checked by `tools/verify-levels.mjs`). Shipped pools are **mixed**: an even split of the styles that bucket has, each entry tagged `t` — see "Mixing the styles" |
| `js/game.js` | `Game` class: interactive state, quick-mode auto-marks, conflict + dead-unit (region/row/column) + win detection, and `hasError(solution)` — the pure yes/no behind the "Prüfen" status / live lamp (rules + solution-aware, reveals no position) |
| `js/hint.js` | `computeHint(...)` → the simplest next deduction as structured data the UI renders and explains |
| `js/highscores.js` | Score model (`computeScore` = time + hint penalty; mistakes are counted, not charged) + local top list (`MAX_LOCAL_ENTRIES` = 50) per `(size, difficulty)` in `localStorage`, plus the **solve history** behind the relative feedback (`recordSolve` / `getPersonalStats` / `percentileBetter` / `globalPercentile`); pure logic. History entries are **dated** (`[score, at]`, or a bare `score` for the undated ones — see "Time in the score data") |
| `js/leaderboard.js` | Optional global leaderboard via Supabase REST; **network layer**, no DOM. Reads (`fetchTopScores` — optional `{ since }` window, `created_at` per row — and `fetchBucketCounts`) fail soft to `null` (offline/unconfigured/CSP/SQL-not-re-run) so the game stays local-only — mirrors `drawLevel`'s fallback. `submitScore` fails soft too, but to `{ failed: true, attempts }` rather than a bare `null`, so a caller can tell *why* — `attempts` is every `rpcOnce()` try (HTTP status / retriable / error text); `main.js`'s `copySubmitFailureDebug` is the consumer |
| `js/i18n.js` | Translation layer: `t(key, params)`, `resolveLanguage`, the pack registry. **Pure** — no DOM, no browser globals at import time, so Node can import it (`js/hint.js` depends on it and the logic tests import that). Mirrors the audio/voice/leaderboard layering |
| `js/i18n/en.js`, `de.js`, `fr.js`, `es.js`, `pt.js`, `ru.js` | The language packs. Flat `key → string \| (params) => string` maps, one identical key set per language — `tests/logic/verify-i18n.mjs` fails CI otherwise. Each pack owns its own plural/ordinal/percent helpers and its own noun choices; every pack pins the piece to the local name of the *n*-queens problem (`dame` / `reina` / `rainha` / `ферзь`). See "Grammar lives in the pack" below for what that buys |
| `js/settings.js` | Preferences (language/size/difficulty/quick mode/debug/sound/voice) + last nickname in `localStorage` — highscores live in their own key; no live game state is persisted. Settings sub-options (`debugExtended`, edge-coords) hide via the `hidden` attribute — and `.field[hidden]` must win over `.toggle-field { display:flex }`, or they'd stay visible |
| `js/audio.js` | Minimalist sound effects synthesised on the fly with the Web Audio API (no asset files, CSP-safe in the Artifact); **audio layer, no DOM**. Muting is an in-memory flag driven by the `sound` preference; every call fails soft so audio never blocks the game |
| `js/voice.js` | Voice Mode (Beta): `parseVoiceCommand(transcript, N)` is a **pure** German-transcript → command parser (no DOM, no browser globals — Node-testable); `createVoiceController(...)` / `voiceSupported()` wrap the Web Speech API (`SpeechRecognition`) as a **recognition layer, no DOM** that fails soft where the API is missing. Grid notation is chess-like: column letter + row number ("C4" → col c, row r); several coordinates in one utterance ("Punkte auf A2, B2, C3") return a `batch` command, and whole-unit fills ("Punkte Spalte B und C außer Rot") a `fill` command (regions named by colour, which `main.js` resolves to region ids since it owns the shuffled palette; a region can also be named by a cell in it — "Region von C3"). Also wraps `SpeechSynthesis` (`voiceSpeak`) to read hints aloud, and parses `apply`/`dismiss`/`repeat` ("OK"/"Schließen"/"Wiederholen") for the hint pop-up. `dedupeReplayCells(cells, action, prevKeys)` is a **pure** guard against Chrome re-finalising the same utterance (final "i5" then "i5 i6"/"i5 Dame"): it compares parsed effect per cell — drop a repeated `(row,col,action)`, keep a same-cell/**different**-action (a verb upgrading a toggle to a queen), so verb-governed phrases survive where transcript prefix-stripping would corrupt them. `isRefinaliseExtension(prevText, newText)` is the **pure** detector for the other half of the same problem: Chrome finalising a sentence it cut short ("Punkte Zeile 1" before "… außer Region E1"). A premature **fill** can't be repaired by re-running the narrower one (marking only adds), so `main.js` rolls the earlier fill back — identity-checking its undo snapshot against the stack top — and applies the completed utterance. It is only a *detector*: the full new transcript is re-parsed, never stripped. Mirrors the audio/leaderboard layering |
| `js/stats.js` | Anonymous play counters ("pings"): `bumpStat(kind, {size, difficulty})` posts a counter increment to `bump_stat`, `statsSource(env)` is the **pure**, Node-testable rule that decides whether a page counts as `web` / `test` / `dev`. **Network layer, no DOM**, fire-and-forget — returns nothing, so no caller can await a counter — and fails soft everywhere, including a one-shot latch that stops asking after a 404/401/403. Reads `js/leaderboard.js`'s exported `SUPABASE_*` config rather than keeping a second copy. See "The weekly activity report" |
| `js/main.js` | Wires generator + game + hint + highscores + leaderboard + audio + voice to the DOM: rendering, input, timer, hint card, win/score screen, Bestenliste modal, sound toggle, QR share dialog, voice panel + coordinate labels (per-cell corner labels or an edge ruler — the `.board-stage` wraps the board so the rulers sit outside the intro rotation), the hint-cost surfaces (price tag on the button, the flying `+30 s` pill, the effective-time clock — see "Highscores / leaderboard"), debug export (with an optional `debugExtended` journal — the last 20 voice/board events: **every** heard final incl. ones that changed nothing (op `gehört`) plus effect entries, the raw voice transcript, replay-skips, and exactly what each undo removed; back-to-back coordinate finals also carry a short replay guard so a re-finalise doesn't double-apply). Voice commands route into the **same** internal calls a tap/button makes — no duplicate game logic |

### i18n (what is translated, and what deliberately isn't)

`index.html` ships the **English** baseline inline and `<html lang="en">`;
`applyTranslations()` in `main.js` swaps it for the resolved language at boot.
The `.app` shell is `visibility: hidden` until `data-i18n-ready` lands on
`<html>`, so a German player never sees a frame of English. Without JS the page
has no board anyway, so gating on it costs nothing — but it does mean
`build-artifact.mjs` guards that the hook exists (the Artifact has no `<head>`,
only the body slice, so a lost hook would render blank).

- Markup: `data-i18n="key"` (textContent), `data-i18n-attr="aria-label:key|title:key"`,
  and `data-i18n-html="key"` for the *one* value with inline markup
  (`party.text`). `data-i18n-html` is for **our own pack values only** — player
  and leaderboard text still goes in with `textContent`, never `innerHTML`.
- Language resolution (`resolveLanguage`, pure/testable): an explicit stored pick
  wins; otherwise the first `navigator.languages` entry with a pack; otherwise
  **English** — deliberately not German, so an unrecognised locale gets the
  widest-reach default. `settings.language === ''` means "follow the browser".
- Changing the language **reloads the page**. Not for speed (swapping ~150 keys
  is nothing) but because every transient surface would otherwise need
  re-localising: open hint card, win screen, score lists, and the recogniser,
  which has to restart on a new `lang` regardless. A reload always discards the
  board (this project persists preferences, never game state), so
  `onLanguageChange` confirms first when a game is in progress and calls
  `flushPendingWin()` so an unsubmitted solve still reaches the local list.
- Composed sentences are **functions per language**, not `%s` templates — word
  order and agreement differ, so each pack writes its own sentence. Plurals and
  ordinals live inside the pack that needs them (`enOrdinal`, `dePlural`); there
  is no shared plural engine and shouldn't be.
- Units in `hint.js` travel as **kinds** (`'region' | 'row' | 'col'`) and only
  become words at the point a sentence is built. Never branch on a translated
  string.
- An unnamed score is stored **empty**, client- and server-side
  (`docs/leaderboard-setup.sql` no longer substitutes `'Anonym'`): a stored word
  would be frozen in the writer's language on a list everyone reads. The
  placeholder is rendered per reader. That SQL change needs the project owner to
  re-run the file in Supabase — see its `MIGRATION` block.
- **Voice Mode is German-only, and that is not a gap to fill by translating.**
  `js/voice.js` is a *German speech grammar* — spelling alphabet, spoken number
  words, exclusion phrases, and a set of mis-hearings found by actually speaking
  at the recogniser (`"damit"` for "Dame", `"aus der"` for "außer"). None of that
  transfers via a language pack; another language needs its own grammar, its own
  empirically-gathered mis-hearings, its own rewritten ⓘ tutorial (which
  documents the grammar rather than translating it), and its own
  `tests/logic/voice-parse.mjs` table. `applyVoiceSetting` gates the whole
  feature to `getLanguage() === 'de'` and says why in the settings hint — a
  French UI driving a `de-DE` recogniser would just produce nonsense. Lifting the
  gate means adding a grammar, not a pack.
- **The debug journal is deliberately untranslated** (German op labels like
  `gehört`, `Dame E4`, `Replay übersprungen`). It is developer output that ends
  up in bug reports; pinning it to one language keeps those readable, and it is
  mostly Voice-Mode telemetry anyway. Keep new journal labels out of the packs.
- Adding a language = copy `js/i18n/en.js`, register it in `I18N_PACKS` +
  `I18N_LANGUAGES`, add it to `build-artifact.mjs`'s module list (**before**
  `js/i18n.js` — it builds `I18N_PACKS` in a top-level `const`, so a later
  declaration is in the temporal dead zone and the classic-script bundle throws
  at load), and add its locale to `LOCALES` in `tests/browser/i18n-layout.mjs`.
  Then run `node tests/logic/verify-i18n.mjs`. Watch the layout: FR/ES/PT run
  15–30 % longer than EN/DE and `.btn` is `white-space: nowrap`, while
  `.voice-transcript` / `.voice-status` / `.score-name` are single-line ellipsis.
- **Grammar lives in the pack, and Russian is the proof.** `ru.js` needed two
  things no other pack does, and neither cost a line outside that one file:
  **three** plural forms repeating modulo 100 (`ruPlural`: 1/21 → one, 2–4/22 →
  few, 0/5–20 → many), and **declension** — `hint.js` hands a unit word over as
  the nominative string in `hint.unit.*`, but the sentences need it in four cases
  ("в строк**е**", "заблокирует строк**у**", "клетки строк**и**", "строк**е**
  нужен ферзь"). `ru.js` declines it back through `RU_UNIT_FORMS`, an exact
  lookup keyed by the nominative (the three unit kinds are a closed set, so a
  table is honest where a suffix rule would be a guess — keep it in step with the
  `hint.unit.*` values). This is what "composed sentences are functions, not
  `%s` templates" was for: do **not** answer the next such language by adding a
  shared plural engine or a gender/case parameter to `t()`.
- Locale *data* is `Intl`'s job, not the translator's: plural categories
  (`Intl.PluralRules`), percent spacing (`en`/`pt` write `88%`, `de`/`fr`/`es`/`ru`
  write `88 %` with a non-breaking space), dates and relative time. Delegating
  keeps "no dependencies" true for languages whose rules nobody wants to hand-roll.
- **The three-tab score row is the tightest line in the app** (`.score-tabs`,
  three tabs plus "Global 🌐"). Russian's first draft — "Локально" / "Глобально 🌐"
  — overflowed at 95px and had to become "Моя" / "Общая 🌐". It is only measured
  when the period tab is actually offered, which needs `score_counts` to answer
  `recent >= 5 && recent < total`; `tests/browser/i18n-layout.mjs` stubs exactly
  that, so the row is covered rather than accidentally absent.
- **A longer label does not report itself as an overflow.** `overflow-x: clip` on
  `<body>` hides page-level overflow, and `.brand` is a column flex with
  `align-items: flex-start`, which sizes children to their own content and lets
  them spill *past* the column — so a long `ui.newGame` shrank `.brand` while the
  `<h1>` kept its width and painted "Queens" underneath the toolbar buttons.
  Nothing scrolled, nothing was clipped, no test failed; German had been shaving
  the "s" off since the packs landed and it only became obvious in French. The
  fix is layered: `.topbar` wraps, the `<h1>` has `max-width: 100%` + ellipsis as
  the last resort, and the ≤430px media query trims horizontal padding (never
  vertical — that's the touch target) so 375–430px stays one row in every pack.
  When adding a language, measure the top bar at 320/360/375/390/414px, not just
  the modals — and assert on *element* geometry (collision, `scrollWidth` vs
  `clientWidth`), because the page-level check is blind here.
- Browser tests that assert on visible copy **must pin a locale**
  (`openGame({ locale: 'de-DE' })`, or `newPage({ locale })`) — otherwise the UI
  language follows the CI host. `voice-mode.mjs` must be German or the switch is
  disabled and nothing runs.

### Difficulty ↔ solver ↔ hint (keep these aligned)

Difficulty is defined by the deduction techniques a puzzle *requires*, and the
same technique ladder appears in three places that must stay consistent:

- **easy** — only "naked single" (one cell left in a unit).
- **medium** — also line↔region confinement.
- **hard** — also a look-ahead / contradiction (dead-end) step.

`solver.js` rates a puzzle by which techniques solve it; `generator.js` targets
a difficulty using that rating; `hint.js` offers exactly these techniques (plus
Hall-set "crowding" and an honest reveal fallback) so a human-followable hint
always exists. If you add or change a technique, update all three so ratings,
generation, and hints don't drift apart — **and regenerate the pools**
(`node tools/generate-levels.mjs`, then `node tools/verify-levels.mjs`),
otherwise the puzzles shipped in `levels/` keep the old ratings.

### Region-growth styles (how a board *looks*)

Difficulty is about techniques; **style is about geometry**, and the two are
independent. `generatePuzzle(N, difficulty, { style })` takes:

- **`organic`** (default) — `growRegions`, a multi-source flood fill claiming one
  cell per step. Amoeba-ish regions with jagged borders. Its `balance` knob
  *equalises* region sizes and is used only by hard, to suppress single-cell
  "free queen" regions.
- **`blocky`** — `growRegionsBlocky`, which annexes a straight **segment** of up
  to `maxRun` cells per step, so borders come out long and straight and regions
  read as rectangles. Instead of `balance` it has `minSize` (a size *floor*, not
  an equaliser: no free single-cell region, but sizes may still diverge) and
  `dominance`/`maxShare` (one designated background region grows to ~35–40% of
  the board on purpose). `makeUnique` takes `minSize` too — without it the
  uniqueness repair whittles a floor-sized region back down to one free cell.
- **`strips`** — `growRegionsStrips`, which grows a straight, one-cell-wide
  **segment through each queen** and hands everything left over to one background
  region. See "The strips style" below; it is different enough in construction
  that it needs its own uniqueness repair.

Measured against boards from another Queens app (transcribed in
`tools/compare-styles.mjs` as `REFERENCE`), `blocky` matches screenshots A and B
closely — outline corners, background share, strip-shaped regions, zero
single-cell regions — while `organic` essentially never produces it; `strips`
matches screenshot C, which neither of the others does (see below). Run
`node tools/compare-styles.mjs` for the numbers, `--show <N> <difficulty>` for
example boards. `shotLike` is the A/B signature, `stripLike` the C one.

**The style does not make a board easier.** All three reference boards rate
*hard* (level 2, naked-single reach 0) under our own solver, and blocky boards
land at ~75% hard / ~25% medium. **Easy is the exception, twice over**: for
blocky, a size floor of 2 collapses the easy yield to ~0%, because easy *is* the
naked single and needs the forced opening the floor removes — so blocky easy
keeps `minSize: 1` (see `BLOCKY_OPTS`) and gets only the straighter borders, not
the no-freebies signature. Don't "fix" that by raising easy's floor; it silently
converts easy into medium. For strips the same mechanism has no escape hatch:
its floor is what *makes* the look, so it has no easy boards at all.

### The strips style (screenshot C)

A third screenshot showed something neither style produces: on an 8×8, **seven of
the eight colours were straight one-cell-wide segments** (one 1×5, two 1×2, two
1×3, two 1×4) and the eighth was a single amorphous background covering **64%**
of the grid. That is not "blocky with longer runs" — scanned across the 1760
boards the pools held before this style existed, "N-1 regions are strips" was
true of **0.15% of blocky boards and of no organic board at all**, and the
observed maximum strip share was 0.80·N against the screenshot's 0.875·N. A rare
draw of an existing style is a tuning question; a shape that never appears is a
construction question, which is why `growRegionsStrips` exists rather than
another knob on `growRegionsBlocky`.

It inverts the usual job. The other two decide where borders run; this one
decides how much board is *not* a border:

1. seed every region at its queen, pick one at random to be the background,
2. grow each of the other N-1 into a straight segment along one axis, round-robin
   to per-strip caps drawn around a mean (so lengths come out mixed, like the
   screenshot's 2,2,3,3,4,4,5), and
3. give every remaining cell to the background.

**The invariant that makes it cheap**: the background is "every cell no strip
claimed", so it is contiguous exactly when the still-free cells plus its own seed
stay connected. Checking that after each single claim turns "grow a board, test
it, throw it away" into a local veto — the build success rate goes from ~10% to
~100%, and it is why this grower has no retry loop.

**It needs its own uniqueness repair.** `makeUnique` buys uniqueness by moving a
cell into an *arbitrary* neighbouring region, which bends a segment into an L and
destroys the whole point. `makeUniqueStrips` kills an alternate solution the same
way — every solution holds exactly one queen per region, so a second S2 queen in
any region invalidates S2 — but only via two shape-preserving moves: **grow** (a
background cell that continues a strip's line joins that strip; tried first
because it makes the board tighter) and **shrink** (a strip's end cell goes to the
background). Routing strips back through `makeUnique` would still produce valid,
unique, fair boards — they would just quietly stop looking like this, which is
exactly what `tests/logic/strips-style.mjs` fails on.

Three consequences worth knowing before tuning anything:

- **No easy boards, ever.** With a floor of 2 no colour is down to its last cell
  at the start, so the opening is always a line↔region confinement (medium) and
  the naked-single reach is 0. Not one easy board in ~60k sampled across every
  size. `generatePuzzle` still answers an easy request — honestly rated one level
  up — and the pool builder and `randomStyle()` simply don't ask.
- **It shifts which technique a board runs on.** Driving 8×8 boards to completion
  with `computeHint` and classifying each step: confinement is 37% of strips
  steps against 20–26% for organic/blocky, while crowding drops to ~0%. The
  style's geometry *is* "region = subset of a line", which is what that technique
  reads.
- **It is ~20× faster than the others at size 12** (~0.1 s per accepted hard
  board against blocky's ~2 s), because so much of the board is one region that
  uniqueness comes almost for free. That speed is what makes sizes above 12 exist
  at all — see "Board sizes above 12".

`stripCoverage(N)` tapers how much board the strips claim (0.55 at N≤9 down to
0.36). It is a speed knob as much as a look one, and the taper is **not** what
makes big boards look sparse — the construction is. Measured per accepted hard
board:

| N  | coverage 0.36 | 0.42 | 0.50 |
|----|---------------|------|------|
| 12 | 61 ms, share 0.73 | 118 ms, 0.71 | 240 ms, 0.70 |
| 14 | 1.2 s, share 0.74 | 1.5 s, 0.73 | 3.0 s, 0.70 |

Asking for more coverage buys ~4 points of background share for 3–4× the time,
because 1-wide strips block each other and simply cannot cover much of a big
board. Don't re-litigate it by raising the floor; a denser big board needs a
different construction, not a bigger number. So the *look* is held (one dominant
background, N-1 straight segments), not the screenshot's exact 64%, and a 14×14
reads sparser than the 8×8 it came from.

### Mixing the styles (what the pools actually serve)

The styles are **not** an either/or: `generate-levels.mjs --style mixed` fills
each bucket with an even split of every style that bucket has (`mixFor`), so ONE
pool file serves every look. That is deliberately *not* a coin flip per game —
`drawLevel`'s shuffle bag hands the pool out evenly and without repeats, so a
session alternates instead of dealing five of one look in a row. Nothing in
`js/levels.js` changed for this: a mixed pool is just a pool.

`mixFor` has exactly two exceptions, both facts about the styles rather than
preferences: **easy** is organic + blocky (strips has no easy boards), and from
**size 13** up it is strips alone (nothing else finishes in a sane time).

Each mixed entry carries a `"t": "organic" | "blocky" | "strips"` tag. It is
**provenance only** — `decodePuzzle` ignores unknown fields and the game never
reads it; `verify-levels.mjs` uses it to print the real split per bucket, so the
even split is checked rather than claimed. Untagged pools stay valid (format `v`
is still 1), which is why the single-style trial pools need no rebuild.

Live generation mixes too: `randomStyle(N, difficulty)` in `main.js` draws from
`stylesFor(...)`, the same rule `mixFor` applies, and the style rides along to the
worker (`generator.worker.js` forwards it). Without that, the rare board that
misses the pool would always arrive in one fixed look — the one moment a player
would notice the inconsistency. `build-artifact.mjs` overrides exactly that one
line (`const pool = stylesFor(N, difficulty);`) for its single-style trial
bundles, so a rename fails the build instead of silently shipping a mixed bundle.

**Easy is the asymmetric case.** Blocky easy is *not* visually distinctive (the
size floor that creates the look is off there, see above) and carries ~50 % more
single-cell freebie regions than organic easy. Mixing it in is therefore close to
cosmetic on that difficulty — if easy ever feels too generous, dropping blocky
from the easy buckets is the first knob, not the region-growth parameters.

The single-style pools (`levels/*-blocky.json`, 22 buckets × 30) stay around as
the A/B reference and are inert: `drawLevel` only ever asks for
`<N>-<difficulty>.json`. `tests/logic/blocky-style.mjs` and
`tests/logic/strips-style.mjs` guard uniqueness, fairness (hint-solvable),
contiguity and each style's own signature (blocky: the size floor; strips: that
exactly one region is not a strip); they share their board checks via
`tests/logic/lib/board-checks.mjs`. `tools/verify-levels.mjs` covers every pool file,
since it reads each bucket's size/difficulty from the file rather than its name.

Blocky generation is faster than organic at every size (12×12 hard: ~2 s per
accepted board) and strips is faster again (~0.1 s), so a mixed rebuild costs
well under a full organic one — the 22-bucket organic+blocky build measured
~51 min, almost all of it the organic halves, and those still dominate.

A pool build is long enough to invite a background watchdog; if you write one,
do **not** poll with `until ! pgrep -f "generate-levels"`. `pgrep -f` matches
full command lines, so the watchdog's own shell — which contains that string —
matches itself and the loop never exits. It leaves a task "running" for hours
after the build finished. Match on the output file instead (e.g. `until grep -q
"done in" out.log`), or just read the file when the build's own task notifies.

### Board sizes above 12

`MAX_SIZE` is 14, but 13 and 14 are **offered only where they fit**, and the two
halves of that are independent:

- **Can we build one?** Only because of the strips style. Per accepted hard board
  at 13×13: strips ~0.3 s, organic ~12 s, blocky worse. `stylesFor` /
  `mixFor` therefore pin sizes ≥ 13 to strips, and `generate-levels.mjs` builds
  `13-hard` / `14-hard` as strips-only buckets. `HARD_ONLY_FROM` already covered
  them: like 12, an easy/medium board that size essentially doesn't exist.
- **Should we show one?** `maxSizeForViewport()` in `main.js` decides, and it
  **measures rather than computes**: it toggles `.board-xl` on the real board
  element and reads `offsetWidth` back, so the rule lives in CSS alone and the two
  can't drift. A size is offered while a cell would render at ≥ `BIG_BOARD_MIN_CELL`
  (36 px). Measured: phone portrait/landscape → 12, 1280×640 laptop → 13, iPad
  mini portrait / iPad landscape / 1440×800 laptop / desktop → 14 (43–46 px per
  cell). That floor is deliberately *not* applied to sizes 5–12, which already
  ship down to ~30 px on a narrow phone — nothing here should shrink what people
  already play.

Two traps:

- **`offsetWidth`, never `getBoundingClientRect()`.** The board carries the intro
  animation's `rotate`/`scale` transform, and a rect read mid-intro comes back
  scaled (0.71× at its smallest) — which silently costs the big sizes their
  ceiling on a screen that has the room. This cost a debugging round.
- **The ceiling is measured, never persisted.** The boot clamp and the settings
  modal both clamp `settings.size` down, but only pressing *Anwenden* writes a
  size back — otherwise a tablet opened once in portrait would permanently forget
  that its owner plays 14×14 in landscape.

Two more things are sized by `MAX_SIZE` and would fail silently if they fell
behind it: `PALETTE` in `main.js` (one colour per region — the two entries added
for 13/14 were picked by measuring ΔE, see the comment there), and **Voice
Mode's grammar** — `VOICE_COL_WORDS` / `VOICE_NUM_WORDS` in `js/voice.js` have
to name every column and row, or the far edge of a big board is simply
unsayable. Nothing at runtime compares the two, so `tests/logic/voice-parse.mjs`
asserts `VOICE_MAX_SIZE >= MAX_SIZE` and that every column up to `MAX_SIZE`
parses. The **Bestenliste** size slider deliberately goes to `MAX_SIZE` on every
screen: it browses results, including the global list, so a phone should still be
able to look at the 14×14 board someone else played.

`docs/leaderboard-setup.sql` had `p_size ... > 12` in both submit functions and
rejects 13/14 with `bad size` until the project owner re-runs the file — the
2026-09 entry in its `MIGRATION` block. Until then a big-board result is reported
as *refused* (not "unreachable" — `rejectionCopy` gets that right) and still
lands in the local list.

### Precomputed level pools

`newGame()` tries `drawLevel(N, difficulty)` from `js/levels.js` first: a
random pool entry with a random D4 symmetry applied — all 8 rotations/mirrors
preserve the rules, uniqueness, and difficulty rating, and colours are shuffled
at render time anyway, so stored shapes aren't recognisable. Live worker
generation stays as the fallback whenever `drawLevel` resolves `null` (missing
or invalid pool), so the game never depends on the pools existing. **Sizes 12 and
up are hard-only**: an easy/medium board that size (solvable by naked-single /
line↔region techniques) is vanishingly rare, so the UI locks difficulty to
*Schwer* from 12 up (`applyDifficultyConstraint` in `main.js`),
`generate-levels.mjs` builds only the `<N>-hard` bucket there (`difficultiesFor`
/ `HARD_ONLY_FROM`), and no `12-easy`/`12-medium` pools exist. The
in-session no-repeat shuffle-bag is memory-only by design — this project
persists preferences, never game state. Constraints on `js/levels.js` (it is
concatenated into the classic-script Artifact bundle): **no `import.meta`**
(the pool fetch URL is page-relative instead) and no top-level name collisions.
`tools/build-artifact.mjs` embeds the pools as the `__QUEENS_LEVELS__` global,
which `drawLevel` checks before fetching — keep that handshake in sync.

### Hint data shape

`computeHint` returns `{ kind, title, text, targetCells, reasonCells,
lineCells, excludedCells, applyLabel }`. `kind` is one of `place` /
`eliminate` / `mistake` / `none`. The UI already loops over **all**
`targetCells`, so a single `eliminate` hint may legitimately mark several cells
at once (e.g. every cell that dead-ends the same unit) — plural copy and the
apply-label plural are handled in `hint.js`/`elimHint`.

### Sharing (the QR code) and the project link

The settings card's title row carries a small ⓘ button on the right, level
with the heading (`.settings-head`, `#open-qr`), which opens a second overlay
on top of the settings — `#qr-overlay`, z-index 21, with the settings staying
visible behind it, so closing it returns there rather than to the board. That
is why Escape has to close it **first and return**, and why `closeSettings()`
also hides it: it's a child dialog, never a sibling. The button/overlay id
(`open-qr` / `qr-overlay`) predates the icon swap and still reflects the
overlay's original, QR-only purpose — left as-is rather than renamed for a
content addition.

The overlay covers two purposes that share one dialog rather than two: sharing
the game (QR code + link, unchanged) and, below a divider, a one-line pointer
to the GitHub repo (`qr.repoHint` + a plain link, both scoped by the `qr.*`
i18n keys) for players who want to file an issue or open a PR — see
`CONTRIBUTING.md` at the repo root for what a human contributor needs. The
button icon is an info circle (ⓘ) rather than a QR glyph now that the overlay
is about more than sharing; its `qr.button` aria-label/title changed to match.

**The app ships no QR generator.** The address is fixed (GitHub Pages), so the
code is fixed too: a plain `<svg>` in `index.html`. `tools/generate-qr.mjs` is a
dev-only, dependency-free byte-mode encoder that produces it —
`node tools/generate-qr.mjs` prints the SVG, `--check` verifies index.html still
carries the current one. Regenerate and paste it in **if the site's URL ever
changes**, and update the visible link under the code (two independent strings —
`tests/logic/qr-code.mjs` checks they agree).

A wrong QR code still *looks* like a QR code, which is why the test decodes
rather than compares: `tests/logic/qr-code.mjs` reads the finished matrix back
the way a scanner does (unmask, lift the format bits, de-interleave, read the
byte segment) with no code shared with the encoder, then asserts index.html
embeds exactly the code for the live URL. The rendered end of it —
that the browser paints something a real scanner reads at phone size, in both
themes — was verified with a headless render decoded by jsQR; that check needs
dependencies this repo doesn't carry, so it isn't committed. If you change the
SVG output (colours, quiet zone, sizing), redo it rather than trusting the eye:
the quiet zone and the light plate are the parts a dark theme silently eats.

### Highscores / leaderboard

Score = effective time in seconds: `seconds + 30·hints` (lower is better),
bucketed per `(size, difficulty)`. **`computeScore` in `js/highscores.js` and
`queens_score()` in `docs/leaderboard-setup.sql` must stay identical** — if you
retune a penalty, change both. Raw components are stored (not just the final
score) so weights can move without a data migration.

**Mistakes are counted and displayed but carry no penalty** (they cost 15 s
each until 2026-09). The surcharge charged twice for one slip: a wrong queen
already costs the time it takes to notice and undo it, and on a phone a mis-tap
is a thumb's width away — so the penalty was taxing the input surface, not the
reasoning. `mistakes` still rides along everywhere (counter in `main.js`, the
`mistakes` column, `p_mistakes`, the per-row breakdown); only its weight is
gone, and `queens_score`'s three-parameter signature was kept so `submit_score`
and every client call site are unchanged.

**The surcharge is visible while you play, not only afterwards.** Three surfaces
carry it and all three read `HINT_PENALTY`, never a literal:
- The hint button's own label (`decorateHintButton`) — `💡 Hinweis (+30 s)`, plus
  a `title` saying a *repeat* of the same hint is free. Appended from JS rather
  than written into `index.html` because `data-i18n` sets `textContent` and would
  delete a child element at boot; that is why the decoration is called from
  inside `applyTranslations` rather than next to it.
- A `+30 s` pill (`flyHintCost`, `#cost-fly`) rising off the button, and a pulse
  on the timer chip at the same moment so the clock's jump reads as a consequence
  instead of a glitch. `position: fixed`, placed from the button's live rect and
  animated with the Web Animations API, so the `.actions` row — which wraps in
  portrait and becomes a fixed-width column in landscape — never has to make room
  for it.
- **The clock itself shows the effective time** (`displayedTime`), because that
  is the figure the solve is ranked on; `stopTimer` renders once more as it
  freezes, so the last reading *is* the result.

Two traps, both guarded by `tests/browser/hint-cost.mjs`:
- **Add the penalty in `renderTime`, never in `currentElapsed()`.** The raw
  elapsed time feeds the stored `seconds` and the debug journal, and
  `score = seconds + 30·hints` would then charge the surcharge twice. Exactly the
  mistake-penalty trap one level down.
- **Fire the animation from the branch that bumps `hintsUsed`, not from the
  click.** Only *unique* deductions count (`seenHints`), so a re-opened hint is
  free — a pill flying there would promise a charge the score doesn't make.

Because the clock now shows the effective time, `win.breakdown` and
`score.rowTitle` say **"Spielzeit"** rather than "Zeit" and spell the surcharge
out (`· 3 Tipps (+1:30)`); an unqualified "Zeit" next to the big effective number
would look like the game had quietly refunded the hints.

That retune is where "raw components, not just the score" paid off, and both
stores that hold them re-derive rather than trust:
- **Local top list**: `normalizeEntry` now *always* recomputes `score` from
  `seconds`/`hints` on read, so a stored score is derived state. Old entries
  migrate silently on the next read and can't sit in the same list under an
  older formula. (This is why a test can no longer state a score independently
  of its components.)
- **Supabase**: a repeatable `update public.scores set score =
  queens_score(...)` in section 3 of `docs/leaderboard-setup.sql` backfills
  every existing row — `is distinct from`, so a re-run is a no-op. Until the
  owner re-runs the file the server keeps the old formula and the global list
  sits 15 s per mistake above the local one; nothing breaks.
- **The solve history cannot be repaired**: it stores bare scores with no
  components, so pre-2026-09 entries keep their inflated value forever. Same
  category as the undated entries — a permanent wrinkle, not a migration step.
  Two consequences, both accepted: a fresh solve compares slightly favourably
  against those old ones, and `mergeSolveSamples` can double-count a solve whose
  top-list copy recomputed to a different value than its history copy.
**Clearing the board does not start a new attempt.** `startTimer()` is the
*new board* entry point — it zeroes the clock, `hintsUsed`, `seenHints` and
`mistakes` — and **Zurücksetzen must not call it** (`doResetBoard` in `main.js`,
shared by the button and the voice command). It used to, which made the button a
highscore cheat: play a board almost to the end, memorise where the queens sit,
reset, and replay the solution against a clock starting at 0:00 (it laundered the
hint surcharge the same way). The LinkedIn original keeps its clock running too;
budgeting your own time is part of the game. A reset therefore clears only the
board — same puzzle, same attempt, running clock, and the journal stays (the
regions didn't change, so its coordinates still refer to this board).
`tests/browser/reset-timer.mjs` guards it, because the fix is a *subtraction*
and nothing else would notice a refactor routing reset back through
`startTimer()`.

Counters live in `main.js`: `hintsUsed` bumps in `showHint` but only for
**unique** deductions — a `seenHints` set of hint signatures (`hintSignature`)
dedupes, so re-requesting the same hint (shown, dismissed unapplied, asked
again on an unchanged board) doesn't penalise the score twice; `mistakes` bumps
in the tap handler when a queen lands off `currentSolution`; both (and
`seenHints`) reset in `startTimer`. `onWin` is guarded by `winHandled` (fires once per solve) and a
`pendingWin` is committed to the local list on submit or when the board is left
(`flushPendingWin`). A global submit **auto-retries transient failures** with
backoff (`submitScore` → `rpcWithRetry` in `leaderboard.js`: up to 4 tries; a
4xx is treated as permanent and not retried) and, if those are exhausted, the
win button becomes a manual *"Erneut versuchen"* instead of a dead end — one
network blip must not lose a hard-won result. If Debug mode is on when that
failure message shows, `main.js`'s `copySubmitFailureDebug` copies the full
debug state plus `submitScore`'s per-attempt diagnostics (HTTP status /
retriable / error text) to the clipboard **immediately** — no confirmation, no
extra button — so a report of *why* the global leaderboard was unreachable
(client-side vs. the provider) doesn't depend on reproducing the failure later.
Submitting the **same** solve to
the global board twice is prevented by `pendingWin.submittedGlobal`, which
latches true only on a confirmed insert (submit_score has no server-side
idempotency key, so this client latch is the guard). The online layer is
best-effort abuse-protected server-side (plausibility + rate-limit); it can't be
truly cheat-proof since the client reports its own time — say so, don't
oversell it. Untrusted leaderboard names
are always rendered with `textContent`, never `innerHTML`.

**A server check that rejects real play is a bug, not security.** `queens_min_seconds`
used to be `greatest(3, p_size)` and refused genuine fast solves (a 6×6 in 5 s) with
`implausible time` / HTTP 400. Since the client reports its own time, that floor
never stopped anyone who wanted to cheat — it only cost functionality, so it is now
a flat `1`. Keep new server-side validation on the same side of that trade, and
remember any change to `docs/leaderboard-setup.sql` needs the project owner to
re-run it in Supabase (the file is repeatable; the `MIGRATION` block at its end
lists what changed).

`submitScore` distinguishes **refused** from **unreachable**: a permanent 4xx comes
back as `{ rejected: true, reason }` with the server's own message extracted by
`serverReason`, and `main.js`'s `rejectionCopy` maps it to German and decides
whether a retry could ever help (only `rate limited` can). Before that split, a
rejection was reported as "Global nicht erreichbar", which sent the player hunting
for a network fault that didn't exist and offered a retry that could not work.

**Relative feedback (beyond the absolute placement).** The local top list discards
everything past `MAX_LOCAL_ENTRIES`, so it cannot answer "how does this solve compare to
all my others?" — a second, tiny store does: `queens-clone-solves`, one flat
array per bucket of `[score, timestamp]` pairs (no names; see "Time in the score
data" for the undated legacy form), capped at
`MAX_SOLVE_HISTORY` with the oldest falling off. `recordSolve` is called from
`commitPendingWin` — the single funnel every finished game passes through, and
already guarded by `pendingWin.saved`, so a solve is counted exactly once. The
two feedback surfaces are **not alternatives**; they differ in what data they
have and when:
- **Win card** (`#win-personal`, `renderPersonalFeedback` in `main.js`) — the
  *personal* comparison, computed by `getPersonalStats` in `onWin` **before**
  `recordSolve` adds this solve, so "deiner N bisherigen Partien" means the ones
  before it. Available instantly, offline, without a name or a submit.
- **Submit status line** — the *global* comparison, which only exists once
  `submit_score` has answered with `{ rank, total }` (`globalPercentile`).

Both suppress the percentage when the sample is too small to mean anything
(`MIN_SOLVES_FOR_PERCENTILE`, `MIN_GLOBAL_FOR_PERCENTILE`) and fall back to the
plain placement; `percentileBetter` counts a tie as half and never rounds to a
flat 0/100 unless the score really beat none/all.

`seedSolveHistory()` runs once at boot and backfills each bucket's history from
that bucket's top list. Devices that played before the history existed would
otherwise compare a fresh solve against nothing — the card claiming "von 2
Partien" directly above ten older entries. It **tops up** a partly filled history
too, not just an empty one: a device that recorded a handful of solves before
this backfill shipped would otherwise compare against those few forever (the
observed symptom: "besser als 100 % deiner 7 Partien · Platz 1 von 8" printed
directly above a sixteen-row list with a better time at the top — `bestScore`
already read both stores, `rank`/`total`/`percentile` only the history).

What makes topping up safe is `mergeSolveSamples(history, topScores)`, pure and
the only place that reconciles the two stores: **never concatenate them.** Every
solve since the history existed is in *both*, so concatenating double-counts it;
each also holds what the other lost (the top list remembers pre-history solves,
the history remembers solves that fell off the list's cap — that's how a 280
survives with nothing near it in the list, from when the cap was still 10). The
merge is a multiset union — per score value `max(count in history, count in top
list)` — and backfilled scores go to the *front*, where the history cap evicts
first, so real recorded solves are never displaced. That makes a re-run a no-op,
which is why no migration flag exists; keep it that way.

Known and accepted: the recovered scores are the player's *best* ones, not a fair
sample, so a percentile against a freshly backfilled bucket understates the new
solve (real solves dilute it); anything evicted while the list still held 10 is
gone, so the reported count is a lower bound on games actually played; and two
distinct solves with an identical score, one in each store, collapse into one.

The global tab marks the player's own row with the same `.me` highlight the local
list uses, but only **after** a submit — before that the solve genuinely isn't on
the board, so nothing is highlighted and `noteGlobalNotSubmitted` borrows the
(collapsed-while-empty) submit status line to say so rather than growing the
card. The row is found by `matchOwnEntry`, **not** by indexing with the server's
rank — see "One tie rule everywhere" below for why that indexing was wrong.

### One tie rule everywhere: matching doesn't overtake

Four places decide where an equally good result lands, and they must agree —
they didn't, and the visible symptom was the green "that's you" outline sitting
one row **above** the entry that had just been submitted:

- `top_scores` orders `score asc, seconds asc, created_at asc`, so among
  identical values the newest — the one just inserted — is **last**.
- `saveLocalScore` pushes the new entry and sorts with a *stable* sort, so an
  exact tie also stays last. `previewRank` now mirrors that (it counts an
  existing entry as ahead on `e.seconds <= seconds`); before, it put the fresh
  row *first* among ties and the list visibly re-sorted itself on save.
- `submit_score` used to count only strictly better rows, ranking a tie in the
  new entry's favour — the returned rank then pointed at the FIRST row of the
  tied run while the list had ours at the end. It now counts rows that sort
  before the new one under the same four-part ordering (`(score, seconds,
  created_at, id) < …`), so rank and list position agree exactly.
- `matchOwnEntry` therefore ignores the rank entirely and picks, among
  value-identical rows, the one with the newest `at` (or the last position when
  the server sends no `created_at`). That rule holds on an un-migrated database
  too, which is why the client doesn't depend on the SQL change above.

The one deliberate exception is `getPersonalStats`'s `rank`: it ranks a fresh
solve among the player's own past ones with no list underneath it to contradict,
so a tie there stays in the new solve's favour. `percentileBetter` is unrelated
again — a tie counts as half a win there, the standard percentile convention.

Debug mode adds the whole scoring picture to the debug export
(`buildResultDebug` → `info.result`): score components and formula, the
`getPersonalStats` snapshot the card was rendered from (kept on
`pendingWin.personal`), the raw history + top-list scores behind it, and the global
rank/total. Board state alone can't explain a percentile, which is what made the
empty-history bug undiagnosable from an export. The win card carries its own
copy button (`#win-debug-row`, debug-only) because the interesting moment is the
one right after a solve.

### Time in the score data (entry age, rolling windows)

Both stores now carry *when* a solve happened, and the three surfaces built on
that are deliberately **conditional** — each one hides itself where it would say
nothing:

- **Entry age per row** (`renderScoreList` → `entryTime` / `ageParts` +
  `score.age`). The local list has always stored an ISO `date`; `top_scores` now
  returns `created_at` too. The unit travels as an Intl kind (`'day'`, `'month'`,
  …) and each pack turns it into words via `Intl.RelativeTimeFormat`
  (`numeric: 'auto'`, so -1 day reads "gestern"), exactly like `hint.js` passing
  unit *kinds* rather than nouns. A row with no timestamp — an un-migrated
  server, or the not-yet-saved preview row on the win card — simply shows none.
- **The personal window** (`getPersonalStats(...).recent`, `RECENT_WINDOW_DAYS`
  = 30): the same comparison over current form, rendered as a third
  `.win-personal` line. Dropped when the window holds fewer than
  `MIN_RECENT_SOLVES` dated solves, and — just as important — when it covers the
  *whole* history, where it would only reword the all-time line.
- **The global period tab** (`PERIOD_DAYS` = 90, `MIN_PERIOD_ENTRIES` = 5, in
  `main.js`): a third tab in the Bestenliste modal only. `score_counts` answers
  `{ total, recent }` per bucket and `periodOffered` gates the tab on
  `recent >= MIN_PERIOD_ENTRIES && recent < total` — the same two-sided rule.
  This matters because the bucket space is already thin: 22 buckets over ~240
  global entries, so an unconditional month tab would be empty nearly everywhere.

Rolling windows, not calendar months: a calendar month is empty on the 1st and
full on the 28th, so the identical solve would read completely differently
depending on the date. Both lengths are one constant each.

**Undated solves are permanent, not a migration step.** A history entry is
`[score, at]` or a bare `score`; the bare form is what the pre-dating build wrote
and what a top-list entry without a usable date backfills to. Time-scoped figures
count dated solves only, all-time figures count every solve (an undated solve did
happen). `seedSolveHistory` passes top-list *entries* rather than scores into
`mergeSolveSamples` precisely so the backfill keeps their `date` — that is what
lets a device that just updated answer "the last 30 days" at all.

**The SQL migration is optional at runtime, and that is load-bearing.**
`top_scores` had to be dropped and recreated (its return columns changed), and
`score_counts` is new — so until the project owner re-runs
`docs/leaderboard-setup.sql`, the deployed site talks to a server that has
neither. Both paths fail soft: no `created_at` → no age shown; `score_counts`
404 → the period tab never appears. `fetchTopScores` therefore sends `p_since`
**only when set**, so the plain all-time call stays byte-for-byte the pre-feature
one and keeps resolving against the old three-argument function. Keep it that way
— an unconditional parameter would 404 the global tab on every un-migrated
database.

**List length is a layout question, not a data one.** Both lists hold up to 50
(`MAX_LOCAL_ENTRIES`, `TOP_SCORES_LIMIT` — `top_scores` clamps `p_limit` to 100
server-side, so 50 needs no SQL change, and the bucket index covers the ORDER BY,
making 50 rows the same scan as 10). What makes that safe is `.score-list`'s
`overflow-y: auto` plus a **height cap on `.win-card`**: the card is anchored at
the bottom and its fixed parts alone are ~390 px, so before the cap it covered
the top bar on a short phone even with ten rows. The card is a flex column, the
list is the part allowed to shrink (`min-height: 0` on `.score-panel`), so
growing the cap changes the card's height by nothing — measured 729 px at 25, 50
and 100 rows on a 844 px viewport. A fresh row far down the list would be marked
off-screen, so `scrollRowIntoView` centres it; it runs in a `requestAnimationFrame`
because both callers build the list *before* revealing their card, and rects are
all zero while it's still `display: none`.

`tests/logic/percentile.mjs` covers the pure logic (with a localStorage shim,
including the dated storage format and the window rules) and
`tests/browser/win-feedback.mjs` the wiring — seeding, the highlight, the
pre-submit note, entry ages, the window line and the debug block, with every RPC
mocked so the live leaderboard is never written to.
`tests/browser/leaderboard-period.mjs` covers the adaptive tab bucket by bucket
(offered / too thin / everything recent / server without `score_counts`) and
measures the three-tab row down to 320px — three tabs plus "Global 🌐" is the
tightest label row in the app, which is why `.score-tabs` shrinks below 380px. Bundle constraint:
`highscores.js`/`leaderboard.js` are concatenated into one classic script, so
**no top-level name collisions** (that's why the store key is `SCORES_KEY`, not
another `KEY`) and **no `import.meta`**.

### The weekly activity report

`tools/weekly-report.mjs` + `.github/workflows/weekly-report.yml` post one GitHub
issue a week summarising the global leaderboard; GitHub's notification mail *is*
the weekly mail (no SMTP, no third party, no password to rotate). Setup and the
full rationale live in `docs/weekly-report.md`.

Four things that are load-bearing:

- **It is deliberately deterministic** — same rows plus same window produce
  byte-identical text. That rules out `Intl`, `toLocaleString` and local time:
  everything is UTC by construction with hand-written formatters, because a
  report that regroups days depending on where the job ran can't be compared to
  last week's. It also rules out generating it from a model.
- **The state is the last issue, not a file in the repo.** The window starts
  where the previous report ended, and that timestamp rides in an HTML comment
  (`queens-report-state`) at the bottom of each report, found again via the
  `wochenbericht` label. A committed state file would have to push to `main`,
  which branch protection rejects and which `deploy.yml` would answer by
  redeploying the site weekly. The invariant is better too: the window advances
  only when a report was actually delivered, so a failed run merges into the
  next one instead of losing a week.
- **It reads the table directly as `service_role`**, not through `top_scores()` —
  those functions deliberately never return `client_key`, which is exactly what
  the device count needs. That key bypasses RLS and belongs only in the
  `SUPABASE_SERVICE_KEY` repo secret, never in `js/leaderboard.js`.
  `docs/leaderboard-setup.sql` section 7 grants the read; without it the job
  gets a 401.
- **Say what the numbers are.** A row exists only for a solved *and submitted*
  game, so nothing here measures games played or visitors, and `client_key` is a
  daily salted IP hash — hence "devices per day" and "device-days", never
  "users". Every report carries that caveat in a collapsed "Lesehilfe" block;
  keep it there rather than letting the figures read like analytics.

The report's own text is **German**, like the debug journal and the SQL comments:
it is operator output read by one person, not a player surface, so it stays out
of the language packs.

#### The play counters, and why they never touch the leaderboard's numbers

`scores` only ever learns about a game that was solved **and** submitted.
`js/stats.js` + `play_stats` (section 8 of the SQL) close that gap with three
counters — `app_open`, `game_start`, `game_win` — which the report renders as a
funnel ending in the submission count. Rules that must not erode:

- **Two stores, never one number.** Submissions come from `scores` and only from
  `scores`; pings come from `play_stats` and only from there. They live in
  separate report sections with separate tables, and `summarizePlay` is a
  separate function returning a separate object for exactly that reason. There
  is deliberately **no `submit` ping**: that figure already exists, exactly, one
  table over — a counter for it would be the same number twice, from two stores
  that can disagree.
- **A counter is not an event.** One row per (hour, kind, source, size,
  difficulty), incremented in place. No row per game, no IP, no client id, no
  session, no cookie, no storage — nothing identifying is sent, which is why the
  feature needs no consent banner and why it still cannot answer "how many
  users". Keep it that way: the moment a ping carries an identifier, this stops
  being a counter and starts being tracking.
- **Test traffic tags itself.** A Playwright run drives the real UI through the
  real code and would otherwise read as a person playing. `statsSource` returns
  `test` on `navigator.webdriver` — checked *before* the hostname, because
  browser tests run against localhost and `dev` would hide the distinction — so
  no test file has to remember to opt in and no forgotten flag can leak a run
  into the real figures. The report counts `web` only and lists the rest under
  "Nicht mitgezählt". Unrecognisable environments fail **closed** to `dev`.
- **Tests still stub it.** `stubStats(page)` in `tests/browser/board-helpers.mjs`
  answers `bump_stat` locally; `openGame` calls it, and a test that builds its
  own page with `browser.newPage()` must call it too (`stats: 'live'` opts out).
  The source tag is what keeps test runs out of the numbers; the stub is what
  keeps the suite from writing to the live project at all — and an un-migrated
  server answers 404, which lands in `errors` as console noise every test would
  otherwise have to tolerate.
- **Hours, not days, and half-open.** Submissions are windowed to the second;
  counters exist per hour. The counter window is snapped to whole hours, ends at
  the last *completed* one, and chains through its own `statsUntil` field in the
  state marker — so consecutive reports never double-count an hour and never
  skip one. A marker written before the counters existed has no `statsUntil` and
  simply starts the counter window at the report window's hour.
- **The whole thing is optional at runtime**, like every other SQL migration
  here: `bump_stat` 404s until the owner re-runs the file, `js/stats.js`
  swallows that (and stops asking for the rest of the page's life), the report
  drops the section, and nothing else changes.

## Git / workflow

- Default branch is **`main`**. Do feature work on a branch and open a PR;
  don't commit straight to `main` unless asked.
- Commit only when the change is verified. Keep commit subjects imperative and
  scoped to one change.
- Deployment: `.github/workflows/deploy.yml` publishes to GitHub Pages on push
  to `main` (or `master`). It's a static upload of the repo root — no build.
- `.github/workflows/weekly-report.yml` runs every Monday 06:00 UTC and files
  the activity report as an issue (see above). It needs the
  `SUPABASE_SERVICE_KEY` secret; `workflow_dispatch` with `dry_run` renders it
  into the job summary without posting or advancing the window. GitHub disables
  scheduled workflows after 60 days without repository activity — if the mail
  stops, check that first.
- `main` has a **branch protection rule**: PRs need the `logic-tests` status
  check (`.github/workflows/ci.yml`, runs `tests/logic/`) to pass, and the PR
  branch must be **up to date with `main`** before the merge button unlocks.
  If GitHub reports the branch as out-of-date, merge/update from `main` first
  (e.g. `git fetch origin main && git merge origin/main`, then push) — don't
  assume a green CI run on an older base is enough to merge.
- **Don't push follow-up commits onto a branch whose PR is already merged.** A
  merged PR is finished — it won't pick up new commits, so they strand on the
  branch, off `main`, looking "pushed" but never shipping (nothing is lost; it's
  just invisible until noticed). Before pushing follow-up work to a branch that
  already had a PR, confirm the PR is still open (e.g. `gh pr view` / a
  `list_pull_requests` check). If it merged, start the follow-up on a fresh
  branch cut from the latest `main` and open a new PR — carry any not-yet-merged
  commits over by rebasing them onto the new base, don't stack them on the
  merged history.
