import {
  INTEGRITY_FLAGS,
  INTEGRITY_VERSION,
  MAX_PLAUSIBLE_WPM,
  MIN_AVG_KEY_INTERVAL_MS,
  MIN_GAP_CV,
  MIN_KEYS_FOR_RHYTHM,
  TIMING_TOLERANCE_MS,
  TIMING_TOLERANCE_RATIO,
} from '../config/integrity.js';

/**
 * Decides whether a finished run may compete. Pure function: no I/O, so the
 * rules are unit-testable.
 *
 * What this can and cannot prove: keystrokes are reported by the client, so a
 * modified client can still fabricate a log. These checks make a forgery
 * expensive (it must replay to the submitted text, fit the server's clock,
 * stay under MAX_PLAUSIBLE_WPM and vary like a human hand) rather than
 * proving a human typed it.
 *
 * @param {object} run
 * @param {'server'|'client'} run.textSource  where the scored text came from
 * @param {Date|null} run.serverStartedAt      set by POST /game/begin
 * @param {Date} run.serverEndedAt             when /game/end was received
 * @param {number} run.clientElapsedMs         endTime - startTime from the client
 * @param {number} run.wpm
 * @param {number} run.rawWpm
 * @param {number} run.textLength             length of the scored text
 * @param {Array<{timestamp:number,currentIndex:number}>} run.performance
 * @param {string} run.typedText              final text submitted by the client
 * @param {ReturnType<import('./keystroke.service.js').analyzeKeystrokes>} run.keystrokes
 * @returns {{ ranked: boolean, flags: string[], integrityVersion: number }}
 */
export const assessRun = ({
  textSource,
  serverStartedAt,
  serverEndedAt,
  clientElapsedMs,
  wpm,
  rawWpm,
  textLength,
  performance = [],
  typedText,
  keystrokes,
}) => {
  const flags = [];

  if (textSource !== 'server') {
    flags.push(INTEGRITY_FLAGS.CLIENT_TEXT);
  }

  if (!serverStartedAt) {
    flags.push(INTEGRITY_FLAGS.NO_SERVER_START);
  } else {
    const serverElapsedMs = serverEndedAt.getTime() - new Date(serverStartedAt).getTime();
    const tolerance = Math.max(TIMING_TOLERANCE_MS, clientElapsedMs * TIMING_TOLERANCE_RATIO);
    if (Math.abs(serverElapsedMs - clientElapsedMs) > tolerance) {
      flags.push(INTEGRITY_FLAGS.TIMING_MISMATCH);
    }
  }

  if (wpm > MAX_PLAUSIBLE_WPM || rawWpm > MAX_PLAUSIBLE_WPM) {
    flags.push(INTEGRITY_FLAGS.IMPLAUSIBLE_WPM);
  }

  if (!isPerformanceConsistent(performance, textLength, clientElapsedMs)) {
    flags.push(INTEGRITY_FLAGS.PERFORMANCE_INCONSISTENT);
  }

  if (!keystrokes || keystrokes.count === 0) {
    flags.push(INTEGRITY_FLAGS.NO_KEYSTROKES);
  } else {
    if (
      !keystrokes.valid ||
      keystrokes.replayed !== typedText ||
      keystrokes.totalGapMs > clientElapsedMs + TIMING_TOLERANCE_MS
    ) {
      flags.push(INTEGRITY_FLAGS.KEYSTROKES_INCONSISTENT);
    }
    if (
      keystrokes.valid &&
      keystrokes.count >= MIN_KEYS_FOR_RHYTHM &&
      (keystrokes.meanGapMs < MIN_AVG_KEY_INTERVAL_MS || keystrokes.gapCv < MIN_GAP_CV)
    ) {
      flags.push(INTEGRITY_FLAGS.ROBOTIC_TIMING);
    }
  }

  return { ranked: flags.length === 0, flags, integrityVersion: INTEGRITY_VERSION };
};

/**
 * The client samples progress once per second. Samples must move forward in
 * time, never beyond the run's duration, and never point past the end of the
 * text. (Not compared to the final typed length: backspacing at the end can
 * legitimately leave earlier samples ahead of it.)
 */
const isPerformanceConsistent = (performance, textLength, clientElapsedMs) => {
  if (!Array.isArray(performance)) return false;
  const maxTimestamp = Math.ceil(clientElapsedMs / 1000) + 1;
  let prevTimestamp = -Infinity;

  for (const sample of performance) {
    const { timestamp, currentIndex } = sample || {};
    if (!Number.isFinite(timestamp) || !Number.isFinite(currentIndex)) return false;
    if (timestamp < prevTimestamp || timestamp > maxTimestamp) return false;
    if (currentIndex < 0 || currentIndex > textLength) return false;
    prevTimestamp = timestamp;
  }
  return true;
};
