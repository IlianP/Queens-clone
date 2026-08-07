// i18n.js
// The translation layer: a key → text lookup plus the language resolution that
// decides which pack is active. PURE — no DOM, no browser globals at import
// time, so Node can import it (js/hint.js depends on it, and the logic tests
// import that). Applying translations to the page lives in js/main.js, which
// stays the only file that touches the DOM.
//
// A pack value is either a string or a function of one params object:
//
//   t('ui.newGame')                     -> "New game"
//   t('hint.place.title', { unit })     -> "Only one cell left in the row"
//
// Composed sentences are functions rather than "%s" templates because word
// order, gender and agreement differ per language — each pack writes its own
// sentence instead of filling slots someone else laid out.
//
// Bundle constraint (this file is concatenated into the classic-script Artifact
// bundle): no `import.meta`, and no top-level name collisions.
import { I18N_EN } from './i18n/en.js';
import { I18N_DE } from './i18n/de.js';
import { I18N_FR } from './i18n/fr.js';
import { I18N_ES } from './i18n/es.js';

// Every pack is measured against this one: it is the default language, the
// baseline text `index.html` ships with, and the fallback for a missing key.
export const I18N_FALLBACK = 'en';

export const I18N_PACKS = {
  en: I18N_EN,
  de: I18N_DE,
  fr: I18N_FR,
  es: I18N_ES,
};

// Selectable languages, in menu order. Names are endonyms — a language is
// always offered in its own language, never translated into the current one.
export const I18N_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
];

export function i18nSupported(lang) {
  return Object.prototype.hasOwnProperty.call(I18N_PACKS, String(lang || ''));
}

// Resolve the language to use. PURE, so it can be unit-tested: `pref` is the
// stored preference ('' / undefined = decide automatically) and `browserLangs`
// the browser's ordered list (navigator.languages). An explicit preference
// always wins; otherwise the first browser language we have a pack for wins;
// otherwise English — deliberately NOT the language this project was written
// in, so an unrecognised locale gets the widest-reach default.
export function resolveLanguage(pref, browserLangs) {
  if (i18nSupported(pref)) return pref;
  for (const raw of browserLangs || []) {
    // "de-AT" / "de_AT" / "DE" all resolve to the "de" pack.
    const base = String(raw || '').toLowerCase().replace('_', '-').split('-')[0];
    if (i18nSupported(base)) return base;
  }
  return I18N_FALLBACK;
}

// The browser's language list, or [] outside a browser (Node, worker).
export function browserLanguages() {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

let currentLang = I18N_FALLBACK;

export function setLanguage(lang) {
  currentLang = i18nSupported(lang) ? lang : I18N_FALLBACK;
  return currentLang;
}

export function getLanguage() {
  return currentLang;
}

// Missing keys are reported once each: a silent empty string is how a language
// pack rots unnoticed, and throwing would take the whole page down over one
// label.
const warnedKeys = new Set();
function warnMissing(key) {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  if (typeof console !== 'undefined' && console.warn) console.warn(`i18n: missing key "${key}"`);
}

/**
 * Translate `key` in the active language.
 * @param {string} key
 * @param {object} [params] passed to the pack entry when it is a function
 * @returns {string} the key itself if no pack defines it (visible, not silent)
 */
export function t(key, params) {
  const pack = I18N_PACKS[currentLang] || I18N_PACKS[I18N_FALLBACK];
  let value = pack[key];
  if (value === undefined) {
    value = I18N_PACKS[I18N_FALLBACK][key];
    if (value === undefined) {
      warnMissing(key);
      return key;
    }
  }
  return typeof value === 'function' ? value(params || {}) : value;
}
