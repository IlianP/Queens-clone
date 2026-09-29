// The two cell cycles in js/game.js: tap() (empty → dot → queen → empty, what a
// finger does) and tapQueenFirst() (empty → queen → dot → empty, what Voice
// Mode's "Koordinate setzt zuerst eine Dame" option gives a bare "C4"). Both must
// come back to empty after three steps and keep queenCount honest.
import { Game } from '../../js/game.js';

let failed = 0;
function eq(got, want, msg) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${msg}${ok ? '' : ` — got ${got}, want ${want}`}`);
}
const state = (g, r, c) => (g.queen[r][c] ? 'queen' : g.mark[r][c] ? 'dot' : 'empty');
const region = Array.from({ length: 5 }, (_, r) => Array(5).fill(r));

{
  const g = new Game(5, region, false);
  const seen = [];
  for (let i = 0; i < 3; i++) {
    g.tapQueenFirst(2, 2);
    seen.push(state(g, 2, 2));
  }
  eq(seen.join(' → '), 'queen → dot → empty', 'queen-first cycle');
  eq(g.queenCount, 0, 'queenCount back to 0 after a full queen-first cycle');
}
{
  const g = new Game(5, region, false);
  const seen = [];
  for (let i = 0; i < 3; i++) {
    g.tap(2, 2);
    seen.push(state(g, 2, 2));
  }
  eq(seen.join(' → '), 'dot → queen → empty', 'tap cycle is unchanged');
}
{
  // Quick mode auto-dots (1,1) next to a queen on (0,0); queen-first still
  // places on the first step instead of treating the auto-dot as a manual dot.
  const g = new Game(5, region, true);
  g.tapQueenFirst(0, 0);
  g.tapQueenFirst(1, 1);
  eq(state(g, 1, 1), 'queen', 'an auto-dotted cell still becomes a queen first');
  eq(g.queenCount, 2, 'queenCount counts both');
}

if (failed) {
  console.log(`tap-cycle: ${failed} FAILED`);
  process.exit(1);
}
console.log('tap-cycle: all checks passed');
