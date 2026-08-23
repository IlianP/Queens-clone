# Queens

**English** · [Deutsch](README.de.md)

### ▶️ Play now: **<https://ilianp.github.io/Queens-clone/>**

A clone of the LinkedIn game **Queens** – plain HTML/CSS/JavaScript, no build step,
runs straight off GitHub Pages and is built for phone and desktop alike.

## Rules

On an `N × N` board split into `N` colour regions you place `N` queens (👑):

- exactly **one queen per row**,
- exactly **one per column**,
- exactly **one per colour region**,
- and **no two queens may touch** – not even diagonally.

Every generated puzzle has **exactly one solution** and is solvable by pure logic
(no guessing needed).

## Playing

- **Tapping** cycles a cell: empty → dot (ruled out) → 👑 → empty.
- **New game** generates a fresh puzzle.
- **🔊 / 🔇** at the top mutes and unmutes the sound effects directly, without
  going through the settings.
- **Reset** clears the current board.
- **Check** briefly reports whether your board is still error-free – just a green
  “✓ No mistakes” or a red “✗ There are mistakes”, **without** revealing where a
  mistake is and **without** suggesting the next move (that is the hint's job).
  A mistake is any rule broken on the current board **and** any departure from
  the unique solution before a rule breaks: a queen that isn't part of the
  solution counts, as does a dot on a cell where the solution needs a queen.
- Mistakes (touching / colliding queens) are marked red.
- A row, column or colour region in which every cell is ruled out and no queen
  stands is outlined in pulsing red – no queen can go there any more, so
  something is wrong.

## Settings (⚙)

- **Language:** English, German, French or Spanish; the default is *Automatic
  (browser)* – if the browser language matches no available translation,
  **English** is used.
  Switching the language reloads the page (you are asked first if a game is in
  progress); a solved but not-yet-submitted result is not lost in the process.
- **Board size:** 5 to 12. At **12** only hard puzzles are possible – a 12×12
  board is inherently hard and “easy”/“medium” puzzles of that size essentially
  don't exist – so the difficulty is fixed to *Hard* there.
- **Difficulty:**
  - *Easy* – solvable with “only one cell left” deductions alone.
  - *Medium* – additionally needs row/column ↔ region deductions.
  - *Hard* – needs a look-ahead (contradiction) deduction.

  Up to board size 11 the difficulty is independent of the board size. Since the
  puzzles come from precomputed pools (see below), the chosen level is always hit
  exactly – including on large boards, where a very easy puzzle would be rare if
  it were generated live.
- **Quick mode:** Placing a queen automatically dots every cell it rules out: the
  whole row, column, colour region and the neighbouring cells.
- **Live check:** Permanently shows a status lamp for whether your board is
  error-free (the same check the **Check** button runs, likewise without
  revealing where the mistake is). It only appears shortly after your last move
  so it doesn't flicker while you play. Without this option the status is
  available any time via **Check**.
- **Sound:** Short, discreet sound effects for placing a queen, dotting, hints and
  solving. Can be muted here or directly via the 🔊/🔇 icon at the top.
- **Voice control (beta, German only):** Steer the game by speaking. The commands
  are a **German** grammar (spelling alphabet, spoken number words, “außer”) and
  not translated labels, so the option is only available while the interface is
  set to German. Cells are named like on a chessboard – a column letter (A…, from
  the left) plus a row number (1…, from the top), e.g. **“C4”** or spelled out
  **“Cäsar vier”**. A panel offers a 🎤 button to start listening, an **ⓘ** button
  with a short command tutorial, and the last thing recognised; while the mode is
  active the coordinates are also shown on the board – either small in each cell's
  corner or (sub-option **“Koordinaten groß am Rand”**) large as a chessboard-style
  ruler along the edge. It uses the browser's built-in speech recognition (Web
  Speech API) – no extra dependency and no server, but currently only in
  **Chrome/Edge** and with microphone permission. Where recognition is missing the
  option is disabled and the game runs on unchanged.

Top right in the settings, level with the heading, sits a small **QR button**: it
opens the game's web address as a QR code, so someone next to you can point their
camera at it and start playing right away – nothing to install. The code is fixed
markup (no generator ships with the app); `node tools/generate-qr.mjs` regenerates
it should the address ever change.

An entry submitted without a name stores **no** name; “Anonymous” is only the
display, and every reader sees it in their own language.

These settings, the last name used and the local best times are kept in
`localStorage` (see *Leaderboard* below). A **game in progress** is deliberately
**not** stored – reloading the page starts a fresh puzzle.

## Leaderboard

After solving, the win screen shows a **result** and asks whether you want to be
listed. The result is an “effective time”: the raw solving time plus a penalty
per **hint** used (+30 s) and per **mistake** (+15 s, a queen off the unique
solution). Lower is better. Every combination of board size and difficulty has
its own ranking; 🏆 lets you browse all of them.

- **Local:** Best times are always stored on the device (up to **50** per
  ranking), with no server at all. The last name entered is remembered so it is
  pre-filled after every round.
- **Global (optional):** If an online ranking is set up, a **Submit** button and a
  *Global* tab appear, likewise with up to 50 entries. Without that setup
  everything simply stays local – online is never a requirement.

Both lists show roughly six to eight rows and **scroll** beyond that so the win
screen doesn't grow; your own fresh row is scrolled into view automatically.

Every row also shows **how old** the entry is (“3 days ago”; the exact date is in the
tooltip), and anything from the last week is highlighted in green. Without that a
leaderboard reads as frozen – this way you can see at a glance whether anyone is
playing right now.

When the global ranking is set up and a bucket is busy enough, a third tab **“90
days”** appears: the same list, restricted to entries from that window. It shows up
**only where it says something** – with fewer than five entries inside the window there
would be nothing to compare, and if every entry falls inside it anyway, it would just
be a copy of the global list. Deliberately a *rolling* window rather than “this month”:
a calendar month is empty on the 1st and full on the 28th, so the same result would
read completely differently depending on the date.

Because a list ends somewhere, a first place beyond it says nothing on its own.
So the game additionally remembers the **results of all** games per ranking (the
score and when it was solved, no names) and shows right on the win screen how the fresh
game compares – e.g. *“Better than 88 % of your 26 games”*, the gap to your own
best time, or *“🏆 New best time!”*. This feedback is there instantly and needs
neither a name nor the internet. With few games (under five) the plain placement
is shown instead – a percentage out of two rounds would be noise.

Because the game history now knows the **date** of every game, a third line is added
where it helps, comparing the same solve against your *current form*: *“Last 30 days:
better than 92 % of 12 games”* or *“🔥 Your best time in 30 days”*. It, too, only shows
up when it adds something – if all your games fall inside those 30 days it says nothing
the line above doesn't already say, and is left out.

After **submitting** to the global ranking, the status line adds the same
comparison for the whole field (*“Rank 37 of 214 – better than 83 % of all
entries”*) once enough entries have accumulated there; in the *Global* tab your
own freshly submitted row is then outlined in green – exactly like in the local
tab. Until you submit, nothing is highlighted there, because your result genuinely
isn't on that board yet (the status line points this out).

Anyone who played before this feature existed doesn't lose the comparison: the
existing entries of the local list are adopted as game history on first start –
including their date, so the 30-day window works right away too. Those are only the
**best** games, though – so as long as few new ones have been added, the percentage
comes out rather strict.


### Setting up the online ranking (optional, Supabase)

GitHub Pages only serves static files, but the game can still reach an online
ranking via `fetch()`. A free [Supabase](https://supabase.com) project is enough
as a backend – no server of your own needed.

1. Create a Supabase project.
2. Run `docs/leaderboard-setup.sql` in the project's **SQL editor**. That creates
   the table and the validated functions `submit_score` / `top_scores` /
   `score_counts` (the server-side plausibility checks = the abuse protection).
   If you have been running the ranking for a while, simply run the file again:
   without it the entry age and the 90-day tab stay off – nothing else changes, since
   both fail soft instead of breaking anything.
3. Enter the **project URL** and the **public anon key** in `js/leaderboard.js`.
   Both values may live in the browser; the `service_role` key must **never** go
   there.

**An honest note:** since the browser reports its own time, no such ranking is
tamper-proof. The server checks (reject impossible times, bound the values,
best-effort rate limit) only keep out crude nonsense – enough for a hobby game,
no tournament claim. Instead of a raw IP, only a salted daily hash is stored for
the rate limit.

That is exactly why the lower time bound is **deliberately very loose**: it used
to be “board size in seconds” and rejected genuinely fast runs (a 6×6 in 5 s is
quite doable in quick mode). Since anyone tampering could simply send a
plausible-looking time anyway, that check only cost functionality. Now only the
impossible (0 seconds) is rejected. If you already set the ranking up, apply the
**MIGRATION** block at the end of `docs/leaderboard-setup.sql` (or just run the
whole file again – it is repeatable and leaves existing data untouched).

If the server refuses an entry, the win screen now says **why** (e.g. “Rejected
globally: time judged impossible”) instead of “unreachable” – and offers no
pointless second attempt. It is saved locally in any case, before anything is
sent at all.

## Puzzle pools

“New game” starts instantly: puzzles aren't computed live but drawn from
precomputed pools in `levels/` – one JSON file per combination of board size and
difficulty, 50 puzzles each. That is **22 pools holding 1100 puzzles** in total
(board size 12 only has a `hard` pool, see above). So that nothing becomes
familiar, every drawn puzzle is randomly **rotated or mirrored** (8 symmetries)
and gets random colours as before – 50 stored shapes thus turn into hundreds of
distinguishable boards. Within a session no shape repeats until every one has had
its turn (in memory only, nothing is persisted).

### Two shape languages

The colour regions are built in **two different styles**, and every pool holds
half of each:

- **organic** – amoeba-like regions with ragged borders.
- **blocky** – regions grow in straight strips, giving long straight borders,
  rectangular shapes and one large background colour.

Because every puzzle in a pool comes up once before anything repeats, the two
looks alternate evenly while playing. **The style changes nothing about the
difficulty** – that depends solely on which thinking techniques a board demands.
Only at *Easy* is the difference barely noticeable: that level needs the small
“gifted” regions that would be what makes the blocky look in the first place.

If loading a pool fails (e.g. files changed offline), the game generates the
puzzle live in the background as it used to – so there is always a board, then
with a randomly chosen style.

The pools are built with `node tools/generate-levels.mjs` and checked with
`node tools/verify-levels.mjs` (uniqueness, difficulty, symmetries, solvability
purely via hints). After changes to the generator/solver logic, both have to run
again.

## Deploying to GitHub Pages

The repo contains a GitHub Actions workflow (`.github/workflows/deploy.yml`) that
deploys the site automatically on every push. One-time setup:

1. In the repository **Settings → Pages**, under *Build and deployment → Source*,
   pick **“GitHub Actions”**.
2. Push to one of the branches configured in the workflow (`main`, `master` or the
   development branch).
3. Once the action has run, the site is reachable at the Pages URL it reports.

Since this is a static site, you can alternatively pick “Deploy from a branch” in
the Pages settings and publish the repo root (`/`).

## Project structure

```
index.html                – Page skeleton
css/styles.css            – Layout & responsive, mobile design
js/solver.js              – Rules, solution counting, logic solver (difficulty rating)
js/generator.js           – Puzzle generation with a guaranteed-unique solution (fallback & pool builds)
js/levels.js              – Loads the precomputed pools, rotates/mirrors at random
js/game.js                – Game state, quick mode, conflict & win detection
js/hint.js                – The next logical deduction as an explainable hint
js/highscores.js          – Score model, local best times & game history for the comparison (localStorage)
js/leaderboard.js         – Optional global online ranking (Supabase, falls back to local silently)
js/settings.js            – Preferences & last name (localStorage)
js/i18n.js                – Translation layer: t(), language resolution (no DOM)
js/i18n/en.js, de.js,     – Language packs (one key set, identical per language)
  fr.js, es.js
js/audio.js               – Minimalist sound effects (Web Audio API, no asset files)
js/voice.js               – Voice control: pure command parser + Web Speech wrapper (no DOM)
js/main.js                – DOM wiring, rendering, controls
levels/                   – Precomputed puzzle pools (JSON, per size × difficulty)
docs/leaderboard-setup.sql – SQL for setting up the optional Supabase ranking
tools/generate-levels.mjs – Rebuilds the pools
tools/verify-levels.mjs   – Checks all pools (uniqueness, level, symmetries, hints)
tools/build-artifact.mjs  – Bundles the app into one file (mobile test as an Artifact)
tools/generate-qr.mjs     – Regenerates the share QR code embedded in index.html
tests/logic/verify-i18n.mjs – Checks the language packs for matching keys (runs in CI)
```

## Translating

The interface is available in **English**, **German**, **French** and
**Spanish**. All text lives in `js/i18n/<language>.js`; every file carries
exactly the same set of keys. Another language is a copy of `js/i18n/en.js` plus
an entry in `I18N_PACKS` / `I18N_LANGUAGES` in `js/i18n.js` and in the module
list in `tools/build-artifact.mjs`.

A pack is not a word-for-word translation: composed sentences are **functions**,
so each language writes its own sentence rather than filling slots someone else
laid out, and plural/ordinal rules live in the pack that needs them (French
treats 0 as singular; Spanish does not). Watch the layout too – the labels are
`white-space: nowrap` and the romance languages run noticeably longer than
English.

`node tests/logic/verify-i18n.mjs` checks that no language loses a key or a
placeholder – it runs in CI too, so a slip shows up at build time rather than on
screen. Deliberately not translated are the **voice control** (a German speech
grammar, see above) and the **debug log** (developer output; one fixed language
keeps bug reports readable).

## Running locally

Because of ES modules the page has to be served over HTTP (not via `file://`):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```
