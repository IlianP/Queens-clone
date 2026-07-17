# Tests

Developer aids for verifying logic and behaviour changes. **This is not CI** —
nothing runs these automatically, and the project still ships with **no build
step and no dependencies** (see `../CLAUDE.md`). They're here so a later session
doesn't have to re-derive how to drive this game from scratch.

Two kinds, split by what they need:

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

`error-delay.mjs` asserts that board error feedback (conflict + dead-unit
marks) stays hidden the instant a queen is placed and only appears after the
delay — so an immediate reaction can't reveal a queen's position.

`leaderboard-retry.mjs` drives a real solve (via hints) to the win screen and
checks the global-submit flow: it **intercepts every Supabase RPC with
`page.route`** — so no test score ever reaches the live leaderboard — fails the
submit endpoint to drive the auto-retry + manual *"Erneut versuchen"* path, then
lets it succeed and verifies the same solve can't be submitted twice
(`pendingWin.submittedGlobal`). Slow by design (it waits out the real backoff).

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
