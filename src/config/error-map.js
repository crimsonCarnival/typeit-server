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
