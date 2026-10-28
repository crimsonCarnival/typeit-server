/**
 * Learn section configuration.
 */
// A lesson counts as passed when the text is finished at this accuracy.
export const LESSON_PASS_ACCURACY = 90;
export const LESSON_WORD_COUNT = 30;
// Real words generated to find enough that use only a lesson's keys.
export const LESSON_CANDIDATES = 2000;
// Short key patterns ("fjdk") pad early lessons with too few real words.
export const LESSON_MIN_REAL_WORDS = 8;

export const COMMON_WORDS_PER_RUN = 50;
export const LIST_WORDS_PER_RUN = 50;

// Custom word lists
export const MAX_WORD_LISTS = 20;
export const MAX_LIST_NAME_LENGTH = 40;
export const MAX_LIST_WORDS = 500;
export const MAX_WORD_LENGTH = 30;

// Spaced repetition of missed digraphs (Leitner boxes). A miss puts a pair
// in box 1, due at once; practising it cleanly when due moves it up a box
// and pushes the next review out; clearing the last box retires it.
export const REVIEW_INTERVAL_DAYS = Object.freeze([0, 1, 3, 7, 14, 30]); // index = box
export const REVIEW_MAX_BOX = REVIEW_INTERVAL_DAYS.length - 1;
// A clean review needs the pair typed at least this often in one run.
export const REVIEW_MIN_CLEAN = 2;
export const REVIEW_PAIRS_PER_RUN = 8;
export const REVIEW_WORD_COUNT = 40;
