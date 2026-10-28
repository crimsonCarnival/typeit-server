/**
 * Daily challenge configuration. Days run from 00:00 to 24:00 UTC.
 */

// Settings rotate deterministically per day from this pool (picked with the
// day's seed). Always words mode: phrases come from a small fixed paragraph
// list that players would quickly memorise.
export const DAILY_SETTINGS_POOL = Object.freeze([
  { wordCount: 25, timeMax: 30, punctuationEnabled: false, numbersEnabled: false },
  { wordCount: 40, timeMax: 60, punctuationEnabled: false, numbersEnabled: false },
  { wordCount: 40, timeMax: 60, punctuationEnabled: true, numbersEnabled: false },
  { wordCount: 50, timeMax: 60, punctuationEnabled: false, numbersEnabled: true },
  { wordCount: 50, timeMax: 90, punctuationEnabled: true, numbersEnabled: false },
  { wordCount: 75, timeMax: 120, punctuationEnabled: false, numbersEnabled: false },
]);

export const DAILY_LEADERS_LIMIT = 10;
// Past-days strip: this many days before today.
export const DAILY_HISTORY_DAYS = 6;
