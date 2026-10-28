import Session from '../models/session.model.js';
import { MAX_KEYSTROKES, TIMING_TOLERANCE_MS } from '../config/integrity.js';
import { PROGRESS_MAX_KEYS_PER_BATCH } from '../config/gameplay.js';
import { isKeystroke, liveStats, replayRun } from './run-engine.js';

// Races start up to RACE_COUNTDOWN before anyone can type; nothing longer is plausible.
const MAX_LEAD_MS = 10 * 60 * 1000;

/** Checks a batch of keys from the client: `null` when fine, else an error message. */
export const checkKeyBatch = (from, keys) => {
  if (!Number.isInteger(from) || from < 0) return 'Invalid key offset';
  if (!Array.isArray(keys) || keys.length > PROGRESS_MAX_KEYS_PER_BATCH) return 'Invalid keys';
  if (!keys.every(isKeystroke)) return 'Invalid keys';
  return null;
};

/**
 * Run duration to score with: the client's measurement, kept within what the
 * server's own clock allows (no longer than server time since the start plus
 * latency) and never shorter than the keys it already sent.
 */
export const boundedElapsedMs = (run, clientElapsedMs, replay, now = Date.now()) => {
  const minimum = (run.leadMs || 0) + (replay?.lastT || 0);
  let ms = Number.isFinite(clientElapsedMs) ? clientElapsedMs : minimum;
  if (run.startedAt) {
    ms = Math.min(ms, now - new Date(run.startedAt).getTime() + TIMING_TOLERANCE_MS);
  }
  return Math.max(ms, minimum, 0);
};

/** Replays a run's whole log, cut at its deadline. */
export const replayOf = (run, keys = run.keys) =>
  replayRun(run.text, keys, run.rules, { leadMs: run.leadMs || 0, timeMax: run.timeMax });

/**
 * Appends a batch of keys to a run (guest run in memory, or the player's
 * Session) when `from` matches what the server already holds, and returns
 * live stats for the display.
 *
 * @returns {Promise<{ conflict: number } | { error: string } | { run: object, replay: object, live: object, keyCount: number }>}
 */
export const appendKeys = async (run, { from, keys, elapsedMs, leadMs }, now = Date.now()) => {
  const invalid = checkKeyBatch(from, keys);
  if (invalid) return { error: invalid };
  if (from !== (run.keyCount || 0)) return { conflict: run.keyCount || 0 };
  if (from + keys.length > MAX_KEYSTROKES) return { error: 'Keystroke log is full' };

  const allKeys = keys.length ? [...(run.keys || []), ...keys] : run.keys || [];
  const sets = {};
  if (from === 0 && keys.length) {
    // Normal runs start at the first key; a race started at its shared start.
    if (!run.startedAt) {
      const batchMs = keys.reduce((a, [gap]) => a + gap, 0);
      sets.startedAt = new Date(now - batchMs);
    } else if (run.raceCode && Number.isFinite(leadMs)) {
      sets.leadMs = Math.min(Math.max(Math.round(leadMs), 0), MAX_LEAD_MS);
    }
  }
  const view = { ...(run.toObject?.() ?? run), ...sets };
  const replay = replayOf(view, allKeys);
  sets.typedText = replay.typed;

  let updated = run;
  if (run._id) {
    updated = keys.length
      ? await Session.findOneAndUpdate(
          { _id: run._id, keyCount: from, incomplete: true },
          { $push: { keys: { $each: keys } }, $inc: { keyCount: keys.length }, $set: sets },
          { new: true }
        )
      : run;
    if (!updated) {
      const fresh = await Session.findById(run._id).select('keyCount').lean();
      return { conflict: fresh?.keyCount ?? 0 };
    }
  } else if (keys.length) {
    run.keys.push(...keys);
    run.keyCount += keys.length;
    Object.assign(run, sets);
  }

  const elapsed = boundedElapsedMs(view, elapsedMs, replay, now);
  return { run: updated, replay, live: liveStats(view, replay, elapsed), keyCount: from + keys.length };
};
