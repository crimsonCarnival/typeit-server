/**
 * Phrases-mode text categories. Each maps to a passage pool in data/texts/.
 */
export const TEXT_CATEGORIES = Object.freeze(['classics', 'quotes', 'speeches', 'gta']);
export const DEFAULT_TEXT_CATEGORY = 'classics';

// Small or memorable pools: runs are saved but never ranked.
export const CASUAL_TEXT_CATEGORIES = Object.freeze(['gta']);

// Quotes are short: several are joined until a run has at least this many words.
export const QUOTES_MIN_WORDS = 40;
export const QUOTES_MAX_PER_RUN = 6;
