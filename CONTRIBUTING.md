# Contributing

Thanks for considering a contribution to Queens-clone! This is a small,
dependency-free static site, so the barrier to getting started is low.

## Getting set up

There's no build step and nothing to install. Clone the repo and serve it
over HTTP (ES modules don't load from `file://`):

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Before opening a PR

- **Run the relevant tests.** There's no linter, but `tests/` has a small
  Node-based test suite:
  - `node tests/logic/hint-solve.mjs` – after any change to `solver.js`,
    `generator.js`, `hint.js` or `game.js`. Solves generated puzzles
    end-to-end and checks every queen lands on the solution.
  - `node tests/logic/verify-i18n.mjs` – after touching any UI string (see
    below).
  - `node tests/logic/leaderboard-period.mjs` – after touching
    `leaderboard.js` or `docs/leaderboard-setup.sql`.
  - `tests/browser/` – Playwright tests driving the real DOM (Chromium is
    expected to be preinstalled; see `tests/README.md`).

  CI (`.github/workflows/ci.yml`) runs `tests/logic/` on every push and PR,
  and that check must pass before a PR can merge.

- **Never hard-code player-facing text.** All UI strings are localised
  (English, German, French, Spanish) via `js/i18n/*.js`. Add a key to
  `js/i18n/en.js` and mirror it in `de.js`, `fr.js` and `es.js` — the same
  key set is required in all four packs, and `verify-i18n.mjs` enforces it.
  Two surfaces are deliberately untranslated on purpose (Voice Mode and the
  debug journal, both German-only) — see `CLAUDE.md` for why.

- **Keep your branch up to date with `main`.** Branch protection requires
  the PR branch to be current before it can merge, so rebase/merge `main` in
  if GitHub reports it as out of date.

- **Regenerate the level pools if you change puzzle generation.** If a
  change touches the difficulty rating or deduction techniques in
  `solver.js` / `generator.js` / `hint.js`, keep all three in sync and
  regenerate `levels/` with `node tools/generate-levels.mjs` (then verify
  with `node tools/verify-levels.mjs`), or the shipped puzzles keep the old
  ratings.

## Where things live

`CLAUDE.md` at the repo root has a full architecture writeup — data model,
what each module owns, and the reasoning behind several non-obvious design
decisions (difficulty vs. style, the tie-break rules in the leaderboard, the
i18n layering, etc.). It's written as guidance for an AI coding agent, but
it's equally useful background reading before diving into the code.

## Reporting bugs / suggesting features

Open a GitHub issue. If it's a gameplay bug, turning on **Debug mode** in
Settings gives you a "Copy debug state" button that captures the board,
solver state and (if applicable) the hint — pasting that into the issue
makes it much easier to reproduce.

## License

By contributing, you agree that your contributions will be licensed under
the project's [MIT License](./LICENSE).
