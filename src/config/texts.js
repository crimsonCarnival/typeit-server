/**
 * Phrases-mode text categories. Each maps to a passage pool in data/texts/.
 */
import { CODE_LANGUAGES } from '../data/texts/code.js';
import { WORD_LANGUAGES } from '../data/languages.js';

export const TEXT_CATEGORIES = Object.freeze(['classics', 'quotes', 'speeches', 'gta']);
export const DEFAULT_TEXT_CATEGORY = 'classics';

// Casual text: runs are saved but never ranked. Code snippets are a small
// pool; other word languages aren't comparable with the English boards.
// GTA phrases are ranked like the other phrase categories.
export const CASUAL_TEXT_CATEGORIES = Object.freeze(['code', 'language']);

// Code mode: snippet language.
export { CODE_LANGUAGES };
export const DEFAULT_CODE_LANGUAGE = 'javascript';
// Code display names for attribution.
export const CODE_LANGUAGE_NAMES = Object.freeze({
  javascript: 'JavaScript',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  sql: 'SQL',
  bash: 'Bash',
});

// Words mode language. Only English is ranked: the boards compare like with like.
export { WORD_LANGUAGES };
export const DEFAULT_WORD_LANGUAGE = 'english';

// Quotes are short: several are joined until a run has at least this many words.
export const QUOTES_MIN_WORDS = 40;
export const QUOTES_MAX_PER_RUN = 6;
