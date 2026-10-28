import { BACKSPACE } from '../config/gameplay.js';
import { replayRun } from './run-engine.js';

export { BACKSPACE };

/**
 * Replays a client keystroke log against the scored text and returns the
 * per-key statistics the error map and integrity checks use. A thin view of
 * the run engine (services/run-engine.js), which does the actual replay
 * under the run's rules.
 *
 * @param {unknown} keystrokes  [[gapMs, char], ...]; char is BACKSPACE for a deletion
 * @param {string} text         the session text
 * @param {object} [rules]      the run's typing rules
 */
export const analyzeKeystrokes = (keystrokes, text, rules) => {
  const r = replayRun(text, keystrokes, rules);
  return {
    valid: r.valid,
    replayed: r.typed,
    count: r.count,
    totalGapMs: r.totalGapMs,
    meanGapMs: r.meanGapMs,
    gapCv: r.gapCv,
    keyPresses: r.keyPresses,
    keyErrors: r.keyErrors,
    digraphErrors: r.digraphErrors,
  };
};
