# CLAUDE.md

Guidance for Claude Code when working in this repository. Keep this file
current when the architecture or workflow changes.

## What this is

A browser clone of the LinkedIn game **Queens**: a static site in plain
HTML/CSS/JavaScript with **no build step and no dependencies**. It uses native
ES modules and ships as-is to GitHub Pages. Player-facing text is **localised**
(English, German, French, Spanish — see "i18n" below) — never hard-code a UI
string, add a key to
every language pack instead. Two surfaces stay single-language on purpose: Voice
Mode (German) and the debug journal (German); both are documented below.
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
- `tests/logic/verify-i18n.mjs` — the i18n guard: identical key sets across packs,
  same value *types*, every template still uses the parameters the fallback uses,
  and every key referenced from `index.html` / `t('…')` exists. Run it after
  touching any UI string.
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
hint → leaderboard → main`, stripping `import`/`export` — the strip handles multi-line
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
| `js/generator.js` | Generates puzzles with a guaranteed-unique solution at a target difficulty (runtime fallback + pool builds); two region-growth styles (`organic` / `blocky`), see below — mixing is a *pool*-level concern, the generator only ever grows one style per call |
| `js/levels.js` | Serves precomputed puzzles from `levels/` with a random D4 rotation/mirror per draw; session shuffle-bag; `drawLevel` resolves `null` on any failure |
| `levels/` | Precomputed pools, one JSON per size × difficulty (built by `tools/generate-levels.mjs`, checked by `tools/verify-levels.mjs`). Shipped pools are **mixed**: half organic, half blocky, each entry tagged `t` — see "Mixing the two styles" |
| `js/game.js` | `Game` class: interactive state, quick-mode auto-marks, conflict + dead-unit (region/row/column) + win detection, and `hasError(solution)` — the pure yes/no behind the "Prüfen" status / live lamp (rules + solution-aware, reveals no position) |
| `js/hint.js` | `computeHint(...)` → the simplest next deduction as structured data the UI renders and explains |
| `js/highscores.js` | Score model (`computeScore` = time + hint/mistake penalties) + local top list (`MAX_LOCAL_ENTRIES` = 50) per `(size, difficulty)` in `localStorage`, plus the **solve history** behind the relative feedback (`recordSolve` / `getPersonalStats` / `percentileBetter` / `globalPercentile`); pure logic |
| `js/leaderboard.js` | Optional global leaderboard via Supabase REST; **network layer**, no DOM. Reads (`fetchTopScores`) fail soft to `null` (offline/unconfigured/CSP) so the game stays local-only — mirrors `drawLevel`'s fallback. `submitScore` fails soft too, but to `{ failed: true, attempts }` rather than a bare `null`, so a caller can tell *why* — `attempts` is every `rpcOnce()` try (HTTP status / retriable / error text); `main.js`'s `copySubmitFailureDebug` is the consumer |
| `js/i18n.js` | Translation layer: `t(key, params)`, `resolveLanguage`, the pack registry. **Pure** — no DOM, no browser globals at import time, so Node can import it (`js/hint.js` depends on it and the logic tests import that). Mirrors the audio/voice/leaderboard layering |
| `js/i18n/en.js`, `de.js`, `fr.js`, `es.js` | The language packs. Flat `key → string \| (params) => string` maps, one identical key set per language — `tests/logic/verify-i18n.mjs` fails CI otherwise. Each pack owns its own plural/ordinal helpers (`frPlural` treats 0 as singular, `esPlural` doesn't) and its own noun choices; fr/es pin the piece to the local name of the *n*-queens problem (`dame` / `reina`), and their three unit words are all feminine, which is what lets the hint sentences interpolate a bare `la ${unit}` |
| `js/settings.js` | Preferences (language/size/difficulty/quick mode/debug/sound/voice) + last nickname in `localStorage` — highscores live in their own key; no live game state is persisted. Settings sub-options (`debugExtended`, edge-coords) hide via the `hidden` attribute — and `.field[hidden]` must win over `.toggle-field { display:flex }`, or they'd stay visible |
| `js/audio.js` | Minimalist sound effects synthesised on the fly with the Web Audio API (no asset files, CSP-safe in the Artifact); **audio layer, no DOM**. Muting is an in-memory flag driven by the `sound` preference; every call fails soft so audio never blocks the game |
| `js/voice.js` | Voice Mode (Beta): `parseVoiceCommand(transcript, N)` is a **pure** German-transcript → command parser (no DOM, no browser globals — Node-testable); `createVoiceController(...)` / `voiceSupported()` wrap the Web Speech API (`SpeechRecognition`) as a **recognition layer, no DOM** that fails soft where the API is missing. Grid notation is chess-like: column letter + row number ("C4" → col c, row r); several coordinates in one utterance ("Punkte auf A2, B2, C3") return a `batch` command, and whole-unit fills ("Punkte Spalte B und C außer Rot") a `fill` command (regions named by colour, which `main.js` resolves to region ids since it owns the shuffled palette; a region can also be named by a cell in it — "Region von C3"). Also wraps `SpeechSynthesis` (`voiceSpeak`) to read hints aloud, and parses `apply`/`dismiss`/`repeat` ("OK"/"Schließen"/"Wiederholen") for the hint pop-up. `dedupeReplayCells(cells, action, prevKeys)` is a **pure** guard against Chrome re-finalising the same utterance (final "i5" then "i5 i6"/"i5 Dame"): it compares parsed effect per cell — drop a repeated `(row,col,action)`, keep a same-cell/**different**-action (a verb upgrading a toggle to a queen), so verb-governed phrases survive where transcript prefix-stripping would corrupt them. `isRefinaliseExtension(prevText, newText)` is the **pure** detector for the other half of the same problem: Chrome finalising a sentence it cut short ("Punkte Zeile 1" before "… außer Region E1"). A premature **fill** can't be repaired by re-running the narrower one (marking only adds), so `main.js` rolls the earlier fill back — identity-checking its undo snapshot against the stack top — and applies the completed utterance. It is only a *detector*: the full new transcript is re-parsed, never stripped. Mirrors the audio/leaderboard layering |
| `js/main.js` | Wires generator + game + hint + highscores + leaderboard + audio + voice to the DOM: rendering, input, timer, hint card, win/score screen, Bestenliste modal, sound toggle, voice panel + coordinate labels (per-cell corner labels or an edge ruler — the `.board-stage` wraps the board so the rulers sit outside the intro rotation), debug export (with an optional `debugExtended` journal — the last 20 voice/board events: **every** heard final incl. ones that changed nothing (op `gehört`) plus effect entries, the raw voice transcript, replay-skips, and exactly what each undo removed; back-to-back coordinate finals also carry a short replay guard so a re-finalise doesn't double-apply). Voice commands route into the **same** internal calls a tap/button makes — no duplicate game logic |

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
  at load). Then run `node tests/logic/verify-i18n.mjs`. Watch the layout: FR/ES
  run 15–30 % longer than EN/DE and `.btn` is `white-space: nowrap`, while
  `.voice-transcript` / `.voice-status` / `.score-name` are single-line ellipsis.
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

- **`organic`** (default, and what every pool in `levels/` was built with) —
  `growRegions`, a multi-source flood fill claiming one cell per step. Amoeba-ish
  regions with jagged borders. Its `balance` knob *equalises* region sizes and is
  used only by hard, to suppress single-cell "free queen" regions.
- **`blocky`** — `growRegionsBlocky`, which annexes a straight **segment** of up
  to `maxRun` cells per step, so borders come out long and straight and regions
  read as rectangles. Instead of `balance` it has `minSize` (a size *floor*, not
  an equaliser: no free single-cell region, but sizes may still diverge) and
  `dominance`/`maxShare` (one designated background region grows to ~35–40% of
  the board on purpose). `makeUnique` takes `minSize` too — without it the
  uniqueness repair whittles a floor-sized region back down to one free cell.

Measured against boards from another Queens app (transcribed in
`tools/compare-styles.mjs`), `blocky` matches their look closely — outline
corners, background share, strip-shaped regions, zero single-cell regions — while
`organic` essentially never produces it. Run `node tools/compare-styles.mjs` for
the numbers, `--show <N> <difficulty>` for example boards.

**The style does not make a board easier.** Both reference boards rate *hard*
(level 2, naked-single reach 0) under our own solver, and blocky boards land at
~75% hard / ~25% medium. **Easy is the exception**: with a size floor of 2 the
easy yield collapses to ~0%, because easy *is* the naked single and needs the
forced opening the floor removes — so easy keeps `minSize: 1` (see `BLOCKY_OPTS`)
and gets only the straighter borders, not the no-freebies signature. Don't
"fix" that by raising easy's floor; it silently converts easy into medium.

### Mixing the two styles (what the pools actually serve)

The styles are **not** an either/or: `generate-levels.mjs --style mixed` fills
each bucket half organic, half blocky, so ONE pool file serves both looks. That
is deliberately *not* a coin flip per game — `drawLevel`'s shuffle bag hands the
pool out evenly and without repeats, so a session alternates instead of dealing
five of one look in a row. Nothing in `js/levels.js` changed for this: a mixed
pool is just a pool.

Each mixed entry carries a `"t": "organic" | "blocky"` tag. It is **provenance
only** — `decodePuzzle` ignores unknown fields and the game never reads it;
`verify-levels.mjs` uses it to print the real split per bucket, so "half and
half" is checked rather than claimed. Untagged pools stay valid (format `v` is
still 1), which is why the single-style trial pools need no rebuild.

Live generation mixes too: `randomStyle()` in `main.js` picks per game and the
style rides along to the worker (`generator.worker.js` forwards it). Without
that, the rare board that misses the pool would always arrive in one fixed look —
the one moment a player would notice the inconsistency. `build-artifact.mjs`
overrides exactly that one function for its single-style trial bundles, so a
rename fails the build instead of silently shipping a mixed bundle.

**Easy is the asymmetric case.** Blocky easy is *not* visually distinctive (the
size floor that creates the look is off there, see above) and carries ~50 % more
single-cell freebie regions than organic easy. Mixing it in is therefore close to
cosmetic on that difficulty — if easy ever feels too generous, dropping blocky
from the easy buckets is the first knob, not the region-growth parameters.

The single-style pools (`levels/*-blocky.json`, 22 buckets × 30) stay around as
the A/B reference and are inert: `drawLevel` only ever asks for
`<N>-<difficulty>.json`. `tests/logic/blocky-style.mjs` guards uniqueness,
fairness (hint-solvable), contiguity and the size floor for blocky generation;
`tools/verify-levels.mjs` covers every pool file, since it reads each bucket's
size/difficulty from the file rather than its name.

Blocky generation is *faster* than organic at every size (12×12 hard: ~2 s per
accepted board), so the mixed rebuild costs roughly half of a full organic one —
the full 22-bucket mixed build measured ~51 min, almost all of it the organic
halves.

A pool build is long enough to invite a background watchdog; if you write one,
do **not** poll with `until ! pgrep -f "generate-levels"`. `pgrep -f` matches
full command lines, so the watchdog's own shell — which contains that string —
matches itself and the loop never exits. It leaves a task "running" for hours
after the build finished. Match on the output file instead (e.g. `until grep -q
"done in" out.log`), or just read the file when the build's own task notifies.

### Precomputed level pools

`newGame()` tries `drawLevel(N, difficulty)` from `js/levels.js` first: a
random pool entry with a random D4 symmetry applied — all 8 rotations/mirrors
preserve the rules, uniqueness, and difficulty rating, and colours are shuffled
at render time anyway, so stored shapes aren't recognisable. Live worker
generation stays as the fallback whenever `drawLevel` resolves `null` (missing
or invalid pool), so the game never depends on the pools existing. **Size 12 is
hard-only**: an easy/medium 12×12 (solvable by naked-single / line↔region
techniques) is vanishingly rare, so the UI locks difficulty to *Schwer* at size
12 (`applyDifficultyConstraint` in `main.js`), `generate-levels.mjs` builds only
the `12-hard` bucket (`difficultiesFor`), and no `12-easy`/`12-medium` pools
exist. The
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

### Highscores / leaderboard

Score = effective time in seconds: `seconds + 30·hints + 15·mistakes` (lower is
better), bucketed per `(size, difficulty)`. **`computeScore` in
`js/highscores.js` and `queens_score()` in `docs/leaderboard-setup.sql` must
stay identical** — if you retune a penalty, change both. Raw components are
stored (not just the final score) so weights can move without a data migration.
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
array of scores per bucket (numbers only, no names/dates), capped at
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
rank: `submit_score` ranks a score/seconds tie in the new entry's favour while
`top_scores` orders ties by `created_at` (newest last), so the rank is only used
as a tie-breaker hint between value-identical rows.

Debug mode adds the whole scoring picture to the debug export
(`buildResultDebug` → `info.result`): score components and formula, the
`getPersonalStats` snapshot the card was rendered from (kept on
`pendingWin.personal`), the raw history + top-list scores behind it, and the global
rank/total. Board state alone can't explain a percentile, which is what made the
empty-history bug undiagnosable from an export. The win card carries its own
copy button (`#win-debug-row`, debug-only) because the interesting moment is the
one right after a solve.

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

`tests/logic/percentile.mjs` covers the pure logic (with a localStorage shim) and
`tests/browser/win-feedback.mjs` the wiring — seeding, the highlight, the
pre-submit note and the debug block, with every RPC mocked so the live
leaderboard is never written to. Bundle constraint:
`highscores.js`/`leaderboard.js` are concatenated into one classic script, so
**no top-level name collisions** (that's why the store key is `SCORES_KEY`, not
another `KEY`) and **no `import.meta`**.

## Git / workflow

- Default branch is **`main`**. Do feature work on a branch and open a PR;
  don't commit straight to `main` unless asked.
- Commit only when the change is verified. Keep commit subjects imperative and
  scoped to one change.
- Deployment: `.github/workflows/deploy.yml` publishes to GitHub Pages on push
  to `main` (or `master`). It's a static upload of the repo root — no build.
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
