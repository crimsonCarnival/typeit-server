/**
 * Typing rules and penalties. The server is the only place a run's numbers
 * are computed (services/run-engine.js); the client mirrors the input rules
 * (blocking, skipping) for instant feedback and the server replays them to
 * verify, but every stat comes from here.
 */
export const DIFFICULTIES = Object.freeze(['normal', 'hardcore']);
// 'letter': a wrong key is not accepted. 'word': can't leave a word with errors.
export const STOP_ON_ERROR = Object.freeze(['off', 'letter', 'word']);

export const DEFAULT_RULES = Object.freeze({ difficulty: 'normal', stopOnError: 'off', spaceSkips: false });

/**
 * Penalties per difficulty. Every `backspaceEvery` corrections cost
 * `backspacePoints` score and `backspaceSeconds` of the clock. Mashing one
 * wrong key `spamRun` times in a row blocks further presses; each blocked
 * press costs `spamPoints`/`spamSeconds`.
 *
 * Hardcore keeps the original rules. Normal no longer takes time for fixing
 * mistakes and only nudges the score for heavy correcting.
 */
export const PENALTIES = Object.freeze({
  normal: Object.freeze({ backspaceEvery: 10, backspacePoints: 1, backspaceSeconds: 0, spamRun: 5, spamPoints: 0, spamSeconds: 0 }),
  hardcore: Object.freeze({ backspaceEvery: 3, backspacePoints: 1, backspaceSeconds: 1, spamRun: 5, spamPoints: 1, spamSeconds: 1 }),
});

// A gap longer than this while typing forward counts as away-from-keyboard.
export const AFK_THRESHOLD_MS = 1600;
// Per-second samples ignored by the consistency score (finding the keys).
export const CONSISTENCY_WARMUP_SECONDS = 2;

// Marks a character skipped with "space skips word" in the aligned typed text.
export const SKIP_CHAR = '\u0000';
export const BACKSPACE = '\b';

// Live progress: the client posts new keys about once a second.
export const PROGRESS_MAX_KEYS_PER_BATCH = 1000;

// Guest runs live in memory (no account, no database row).
export const GUEST_RUN_TTL_MS = 30 * 60 * 1000;
export const GUEST_RUN_MAX = 2000;
