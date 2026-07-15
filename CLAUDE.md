# CLAUDE.md

Guidance for Claude Code when working in this repository. Keep this file
current when the architecture or workflow changes.

## What this is

A browser clone of the LinkedIn game **Queens**: a static site in plain
HTML/CSS/JavaScript with **no build step and no dependencies**. It uses native
ES modules and ships as-is to GitHub Pages. Player-facing text is **German** —
match that language in UI strings, hint copy, and `README.md`.

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

There is **no test suite, linter, or package.json**. To verify logic changes,
run the module directly with Node (it's plain ESM) and drive it with a real
puzzle state — e.g. the debug JSON the game can copy (⚙ → debug mode). A good
smoke test for solver/hint changes is to solve a puzzle end-to-end purely by
applying `computeHint` repeatedly and asserting all `N` queens land on the
`solution`. Prefer this kind of behavioural check over eyeballing the diff.

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
(`settings → solver → generator → levels → highscores → game → hint →
leaderboard → main`, stripping `import`/`export` — the strip handles multi-line
imports and a post-strip guard throws if any survive), inlines the `levels/`
pools as the `__QUEENS_LEVELS__` global (the Artifact CSP blocks fetch, so the
online leaderboard is disabled in the Artifact and it runs local-only),
rebuilds the worker as a **classic Blob-URL worker** (module workers and
external URLs are CSP-blocked; the game's own fallback covers a sandbox that
blocks blob workers too), and **prepends `<meta charset="utf-8">`** so the
German text + emoji don't mojibake. Verify the bundle in a mobile-sized
Playwright viewport (Chromium at `/opt/pw-browsers`) before publishing.

## Architecture

Pure logic modules have **no DOM access**; `main.js` is the only file that
touches the DOM. Data model throughout: `region[r][c]` = region id, and a
puzzle solution is `cols[r]` = the column of the queen in row `r`.

| File | Role |
|------|------|
| `index.html` | Page skeleton |
| `css/styles.css` | Layout, responsive/mobile design |
| `js/solver.js` | Rules, unit lists, solution counting (uniqueness), human-style deduction solver + difficulty rating |
| `js/generator.js` | Generates puzzles with a guaranteed-unique solution at a target difficulty (runtime fallback + pool builds) |
| `js/levels.js` | Serves precomputed puzzles from `levels/` with a random D4 rotation/mirror per draw; session shuffle-bag; `drawLevel` resolves `null` on any failure |
| `levels/` | Precomputed pools, one JSON per size × difficulty (built by `tools/generate-levels.mjs`, checked by `tools/verify-levels.mjs`) |
| `js/game.js` | `Game` class: interactive state, quick-mode auto-marks, conflict + dead-unit (region/row/column) + win detection, and `hasError(solution)` — the pure yes/no behind the "Prüfen" status / live lamp (rules + solution-aware, reveals no position) |
| `js/hint.js` | `computeHint(...)` → the simplest next deduction as structured data the UI renders and explains |
| `js/highscores.js` | Score model (`computeScore` = time + hint/mistake penalties) + local top-10 per `(size, difficulty)` in `localStorage`; pure logic |
| `js/leaderboard.js` | Optional global leaderboard via Supabase REST; **network layer**, no DOM. Fails soft to `null` (offline/unconfigured/CSP) so the game stays local-only — mirrors `drawLevel`'s fallback |
| `js/settings.js` | Preferences (size/difficulty/quick mode/debug) + last nickname in `localStorage` — highscores live in their own key; no live game state is persisted |
| `js/main.js` | Wires generator + game + hint + highscores + leaderboard to the DOM: rendering, input, timer, hint card, win/score screen, Bestenliste modal, debug export |

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
Counters live in `main.js`: `hintsUsed` bumps in `showHint`, `mistakes` bumps in
the tap handler when a queen lands off `currentSolution`; both reset in
`startTimer`. `onWin` is guarded by `winHandled` (fires once per solve) and a
`pendingWin` is committed to the local list on submit or when the board is left
(`flushPendingWin`). The online layer is best-effort abuse-protected server-side
(plausibility + rate-limit); it can't be truly cheat-proof since the client
reports its own time — say so, don't oversell it. Untrusted leaderboard names
are always rendered with `textContent`, never `innerHTML`. Bundle constraint:
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
