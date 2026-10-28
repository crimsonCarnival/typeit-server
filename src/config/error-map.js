/**
 * Error map configuration. The map aggregates the per-key data stored on a
 * player's most recent runs (only runs whose keystroke log replayed cleanly
 * carry it; see services/keystroke.service.js).
 */
export const ERROR_MAP_DEFAULT_RUNS = 20;
export const ERROR_MAP_MAX_RUNS = 100;
// How many weakest digraphs the map returns.
export const ERROR_MAP_DIGRAPH_LIMIT = 12;

// Targeted drills ("Drill this key"): words containing the target.
export const DRILL_WORD_COUNT = 40;
// Candidate words generated to find enough that contain the target.
export const DRILL_CANDIDATES = 600;

// "Practice my weak keys": the worst keys (by error rate, with enough
// presses to judge) and digraphs, mixed into ordinary words.
export const WEAK_KEY_LIMIT = 5;
export const WEAK_DIGRAPH_LIMIT = 5;
export const WEAK_MIN_PRESSES = 20;
export const WEAK_WORD_COUNT = 50;
// Share of the run made of words that contain a weak key or digraph.
export const WEAK_WORD_SHARE = 0.6;

// Error trends: weekly buckets over this many weeks (UTC, weeks start Monday).
export const TRENDS_DEFAULT_WEEKS = 8;
export const TRENDS_MAX_WEEKS = 26;
// Keys followed week by week.
export const TRENDS_KEY_LIMIT = 5;
