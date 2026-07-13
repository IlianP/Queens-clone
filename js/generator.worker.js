// generator.worker.js — runs the (synchronous, potentially multi-second) puzzle
// generation off the main thread so the UI can animate a loading/intro sequence
// while a board is being computed. It holds no logic of its own: it imports the
// pure generator and relays its result. Loaded as a module worker
// (`new Worker(url, { type: 'module' })`), so the relative ESM imports resolve
// exactly as they do on the page.
import { generatePuzzle } from './generator.js';

self.onmessage = (e) => {
  const { N, difficulty, budgetMs } = e.data;
  // region (number[][]) and solution (number[]) are structured-cloneable.
  self.postMessage(generatePuzzle(N, difficulty, { budgetMs }));
};
