// The reference boards: screenshots from the LinkedIn original, transcribed
// cell by cell (region ids are arbitrary labels). They are the fixed target the
// generated styles are measured against — a style that reproduces one of these
// is doing what it was built to do, and a screenshot that no style reproduces
// is the argument for building a new one.
//
// Every entry has been fed through our own solver: all four have exactly one
// solution, and the rating is our own reading of the techniques they require.
// Kept in lib/ so both the CLI (tools/compare-styles.mjs) and the regression
// test (tests/logic/style-metrics.mjs) can import them without running anything.
export const REFERENCE = [
  {
    name: 'Screenshot A',
    N: 8,
    rating: 'hard',
    matches: 'blocky',
    region: [
      [0, 0, 2, 3, 3, 3, 3, 3],
      [0, 1, 2, 2, 4, 3, 3, 3],
      [0, 1, 4, 4, 4, 3, 3, 3],
      [0, 0, 4, 4, 4, 4, 3, 5],
      [4, 4, 4, 4, 4, 4, 5, 5],
      [4, 6, 6, 6, 4, 5, 5, 5],
      [4, 4, 4, 4, 4, 5, 7, 5],
      [4, 4, 4, 7, 7, 7, 7, 5],
    ],
    solution: [0, 3, 1, 6, 4, 2, 7, 5],
  },
  {
    name: 'Screenshot B',
    N: 7,
    rating: 'hard',
    matches: 'blocky',
    region: [
      [0, 0, 0, 0, 0, 1, 2],
      [0, 0, 0, 0, 0, 1, 2],
      [0, 3, 3, 3, 3, 1, 1],
      [0, 3, 4, 4, 4, 1, 1],
      [0, 3, 4, 4, 4, 4, 4],
      [0, 5, 6, 6, 4, 4, 4],
      [5, 5, 4, 4, 4, 4, 4],
    ],
    solution: [6, 3, 5, 1, 4, 2, 0],
  },
  {
    // Region 0 is the background (41 of 64 cells). Every other colour is a
    // straight segment: 1 is a 1x5 column, 2/3 are 1x2 rows, 4/5 are 1x3
    // columns, 6/7 are 1x4 rows.
    name: 'Screenshot C',
    N: 8,
    rating: 'hard',
    matches: 'strips',
    region: [
      [1, 2, 2, 0, 0, 0, 0, 0],
      [1, 0, 3, 3, 0, 0, 0, 4],
      [1, 0, 0, 0, 0, 0, 5, 4],
      [1, 0, 0, 0, 0, 0, 5, 4],
      [1, 0, 0, 0, 0, 0, 5, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 6, 6, 6, 6, 0, 0],
      [0, 0, 0, 7, 7, 7, 7, 0],
    ],
    solution: [1, 3, 7, 0, 6, 4, 2, 5],
  },
  {
    // The odd one out, and the reason this file grew a fourth entry. There is
    // no single background: THREE colours (12, 11 and 10 of 49 cells) split the
    // outer ring between them and reach inward, while the four small ones —
    // including a single-cell freebie at D4 — sit landlocked in the middle.
    // It is also the only reference that rates MEDIUM rather than hard.
    // 0 purple, 1 orange, 2 green, 3 blue, 4 grey, 5 red, 6 yellow.
    name: 'Screenshot D',
    N: 7,
    rating: 'medium',
    matches: 'frame',
    region: [
      [0, 0, 1, 1, 1, 1, 1],
      [0, 2, 3, 3, 3, 1, 1],
      [0, 2, 0, 0, 3, 3, 1],
      [0, 0, 0, 4, 3, 1, 1],
      [5, 0, 6, 6, 1, 1, 5],
      [5, 6, 6, 6, 6, 6, 5],
      [5, 5, 5, 5, 5, 5, 5],
    ],
    solution: [0, 4, 1, 3, 5, 2, 6],
  },
];

// ---- the per-style signatures: "does this board have THE look?" ------------
// Each one is a yes/no read off a single board's shape metrics, tuned so the
// screenshot it comes from passes and the styles it is not about mostly fail.
// docs/board-styles.md carries the measured hit rates.

// A/B: no free single-cell colour, but small ones exist; one dominant
// background; at least two strip-shaped regions.
export const shotLike = (m) =>
  m.ones === 0 && m.sizeMin <= 3 && m.maxShare >= 0.3 && m.flatRegions >= 2;

// C, much stricter: every colour but one is a strip, and the one that isn't
// dominates the board.
export const stripLike = (m, N) => m.ones === 0 && m.flatRegions >= N - 1 && m.maxShare >= 0.5;

// D: most colours have lost their foothold on the outer ring, sizes are
// hierarchical — and yet no single colour is a background. That last clause is
// what separates it from C, which also has a low edgeBound.
export const frameLike = (m) => m.edgeBound <= 0.55 && m.gini >= 0.28 && m.maxShare < 0.45;
