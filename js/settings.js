// settings.js
// Persist only the user's preferences (size / difficulty / quick mode / last
// nickname) in localStorage. No game state is stored — a page reload starts
// fresh. Highscores live in their own key (see js/highscores.js); the nickname
// is kept here so the win screen can pre-fill it after every game.

const KEY = 'queens-clone-settings';

export const MIN_SIZE = 5;
export const MAX_SIZE = 12;
export const MAX_NICKNAME_LENGTH = 20;
export const DEFAULTS = {
  size: 8,
  difficulty: 'medium',
  quickMode: true,
  debug: false,
  introAnimation: true,
  nickname: '',
  liveCheck: false,
  sound: true,
};

// Collapse whitespace and cap the length so a stored nickname is always a tidy
// single-line string (shared with the highscore entry sanitiser).
export function sanitizeNickname(name) {
  return String(name == null ? '' : name)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NICKNAME_LENGTH);
}

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
      nickname: sanitizeNickname(s.nickname),
      liveCheck: typeof s.liveCheck === 'boolean' ? s.liveCheck : DEFAULTS.liveCheck,
      sound: typeof s.sound === 'boolean' ? s.sound : DEFAULTS.sound,
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
