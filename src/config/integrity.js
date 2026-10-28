/**
 * Run-integrity rules. A run is "ranked" (eligible for leaderboards, daily
 * challenge and other competitive features) only when it passes every check
 * in services/integrity.service.js. Unranked runs are still saved and shown
 * to the player; they just never compete.
 *
 * Bump INTEGRITY_VERSION whenever the rules change so rankings can filter on
 * runs that were assessed under the current rules.
 */
export const INTEGRITY_VERSION = 2;

// Fastest sustained speed we accept as human. Top competitive typists sit
// around 200-250 WPM on short tests; anything above is treated as automated.
export const MAX_PLAUSIBLE_WPM = 250;

// Allowed gap between the server-measured duration (begin -> end request) and
// the client-reported duration. Covers network latency on both requests.
export const TIMING_TOLERANCE_MS = 2000;
export const TIMING_TOLERANCE_RATIO = 0.05;

// Upper bound on a keystroke log, which also bounds request size. ~10 minutes
// at 120 WPM including corrections.
export const MAX_KEYSTROKES = 8000;

// Rhythm checks only run on logs long enough to be meaningful.
export const MIN_KEYS_FOR_RHYTHM = 50;
// 250 WPM averages ~48ms per key. 15ms leaves room for fast bursts while
// rejecting logs no human hand produces.
export const MIN_AVG_KEY_INTERVAL_MS = 15;
// Human inter-key gaps vary a lot (coefficient of variation typically 0.4+).
// Near-constant gaps indicate a script replaying keys on a timer.
export const MIN_GAP_CV = 0.1;

export const INTEGRITY_FLAGS = Object.freeze({
  CLIENT_TEXT: 'client-text',
  NO_SERVER_START: 'no-server-start',
  TIMING_MISMATCH: 'timing-mismatch',
  IMPLAUSIBLE_WPM: 'implausible-wpm',
  PERFORMANCE_INCONSISTENT: 'performance-inconsistent',
  NO_KEYSTROKES: 'no-keystrokes',
  KEYSTROKES_INCONSISTENT: 'keystrokes-inconsistent',
  ROBOTIC_TIMING: 'robotic-timing',
});
