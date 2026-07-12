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

## Architecture

Pure logic modules have **no DOM access**; `main.js` is the only file that
touches the DOM. Data model throughout: `region[r][c]` = region id, and a
puzzle solution is `cols[r]` = the column of the queen in row `r`.

| File | Role |
|------|------|
| `index.html` | Page skeleton |
| `css/styles.css` | Layout, responsive/mobile design |
| `js/solver.js` | Rules, unit lists, solution counting (uniqueness), human-style deduction solver + difficulty rating |
| `js/generator.js` | Generates puzzles with a guaranteed-unique solution at a target difficulty |
| `js/game.js` | `Game` class: interactive state, quick-mode auto-marks, conflict + dead-region + win detection (pure logic) |
| `js/hint.js` | `computeHint(...)` → the simplest next deduction as structured data the UI renders and explains |
| `js/settings.js` | Preferences (size/difficulty/quick mode/debug) in `localStorage` — no game state or scores are persisted |
| `js/main.js` | Wires generator + game + hint to the DOM: rendering, input, timer, hint card, debug export |

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
generation, and hints don't drift apart.

### Hint data shape

`computeHint` returns `{ kind, title, text, targetCells, reasonCells,
lineCells, excludedCells, applyLabel }`. `kind` is one of `place` /
`eliminate` / `mistake` / `none`. The UI already loops over **all**
`targetCells`, so a single `eliminate` hint may legitimately mark several cells
at once (e.g. every cell that dead-ends the same unit) — plural copy and the
apply-label plural are handled in `hint.js`/`elimHint`.

## Git / workflow

- Default branch is **`main`**. Do feature work on a branch and open a PR;
  don't commit straight to `main` unless asked.
- Commit only when the change is verified. Keep commit subjects imperative and
  scoped to one change.
- Deployment: `.github/workflows/deploy.yml` publishes to GitHub Pages on push
  to `main` (or `master`). It's a static upload of the repo root — no build.
