import { GUEST_RUN_MAX, GUEST_RUN_TTL_MS } from '../config/gameplay.js';

/**
 * Guest runs. Guests have no account and no database row, but their runs
 * are still scored by the server: the text and the streamed keystroke log
 * are held here, keyed by the transient session id handed out with the text.
 * Bounded in size and age; a server restart simply expires them.
 */
const runs = new Map(); // sessionId -> run

const sweep = (now = Date.now()) => {
  for (const [id, run] of runs) {
    if (now - run.lastSeen > GUEST_RUN_TTL_MS) runs.delete(id);
  }
  // Oldest first (Map keeps insertion order; touch() re-inserts).
  while (runs.size > GUEST_RUN_MAX) runs.delete(runs.keys().next().value);
};

setInterval(sweep, 60_000).unref();

/** Stores a guest run (text, settings, rules); returns it. */
export const putGuestRun = (sessionId, run) => {
  const stored = { ...run, sessionId, keys: [], keyCount: 0, startedAt: null, leadMs: 0, typedText: '', finished: null, lastSeen: Date.now() };
  runs.set(sessionId, stored);
  sweep();
  return stored;
};

/** The guest run for `sessionId`, refreshed as recently used, or null. */
export const getGuestRun = (sessionId) => {
  if (typeof sessionId !== 'string') return null;
  const run = runs.get(sessionId);
  if (!run) return null;
  run.lastSeen = Date.now();
  runs.delete(sessionId);
  runs.set(sessionId, run);
  return run;
};

export const deleteGuestRun = (sessionId) => runs.delete(sessionId);

/** For tests. */
export const clearGuestRuns = () => runs.clear();
