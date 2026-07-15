// settings.js
// Persist only the user's preferences (size / difficulty / quick mode) in
// localStorage. No game state or scores are stored — a page reload starts fresh.

const KEY = 'queens-clone-settings';

export const MIN_SIZE = 5;
export const MAX_SIZE = 12;
export const DEFAULTS = {
  size: 8,
  difficulty: 'medium',
  quickMode: true,
  debug: false,
  introAnimation: true,
};

export function clampSize(n) {
  n = parseInt(n, 10);
  if (Number.isNaN(n)) return DEFAULTS.size;
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, n));
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const s = JSON.parse(raw);
    return {
      size: clampSize(s.size),
      difficulty: ['easy', 'medium', 'hard'].includes(s.difficulty) ? s.difficulty : DEFAULTS.difficulty,
      quickMode: typeof s.quickMode === 'boolean' ? s.quickMode : DEFAULTS.quickMode,
      debug: typeof s.debug === 'boolean' ? s.debug : DEFAULTS.debug,
      introAnimation:
        typeof s.introAnimation === 'boolean' ? s.introAnimation : DEFAULTS.introAnimation,
    };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    /* storage unavailable (e.g. private mode) — settings just won't persist */
  }
}
