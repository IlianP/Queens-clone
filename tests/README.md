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

`percentile.mjs` covers the relative-feedback half of `js/highscores.js` — the
solve history, `percentileBetter` / `globalPercentile` (ties count half, and the
rounding never claims a flat 0/100 unless the score really beat none/all),
`getPersonalStats`, the `seedSolveHistory` backfill with its `mergeSolveSamples`
multiset union (idempotent; the reason a pre-history device doesn't report "von 0
Partien", that a partly filled history is topped up rather than skipped, and that
a solve sitting in *both* stores is still counted once) and `matchOwnEntry`. It
installs a small in-memory `localStorage` stand-in, so it stays pure Node.

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

`win-feedback.mjs` covers the win screen's relative feedback, also with **every
Supabase RPC mocked via `page.route`**. It seeds the "played before the solve
history existed" state (full top list, no history) and checks the boot backfill
makes the personal line compare against those games; that the global tab
highlights nothing before a submit but explains the absence in the status line;
that after a submit the player's own row carries the `.me` highlight (found by
value, not by rank index) and the status reports the share beaten; and that the
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

`i18n-layout.mjs` is the layout half of the i18n guard — `logic/verify-i18n.mjs`
checks that the packs *match*, this one checks that they *fit*. It walks all four
languages: the top bar at seven widths (320–640), then every pack value rendered
with realistic parameters into the real element it appears in (hint card, win
card, party overlay, status line), plus the live board/settings/leaderboard/QR-share
surfaces and `<html lang>`.

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
