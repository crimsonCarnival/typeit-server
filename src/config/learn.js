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
