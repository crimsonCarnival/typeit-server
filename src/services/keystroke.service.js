import { MAX_KEYSTROKES } from '../config/integrity.js';

export const BACKSPACE = '\b';

/**
 * Replays a client keystroke log against the scored text. The client only
 * reports what was pressed and when; which key was *expected* is derived here
 * from the server's copy of the text, so error statistics can't be forged
 * independently of the typed text.
 *
 * @param {unknown} keystrokes  [[gapMs, char], ...]; char is BACKSPACE for a deletion
 * @param {string} text         the session text
 * @returns {{
 *   valid: boolean,            log is well-formed and within MAX_KEYSTROKES
 *   replayed: string,          what the log produces when typed out
 *   count: number,
 *   totalGapMs: number,
 *   meanGapMs: number,
 *   gapCv: number,             coefficient of variation of inter-key gaps
 *   keyPresses: Array<{key: string, count: number}>,
 *   keyErrors: Array<{expected: string, typed: string, count: number}>,
 *   digraphErrors: Array<{pair: string, count: number}>,
 * }}
 */
export const analyzeKeystrokes = (keystrokes, text) => {
  const empty = {
    valid: false, replayed: '', count: 0, totalGapMs: 0, meanGapMs: 0, gapCv: 0,
    keyPresses: [], keyErrors: [], digraphErrors: [],
  };
  if (!Array.isArray(keystrokes) || keystrokes.length > MAX_KEYSTROKES) return empty;
  if (!keystrokes.every(isKeystroke)) return empty;

  const buffer = [];
  const presses = new Map();
  const errors = new Map();
  const digraphs = new Map();
  const gaps = [];

  for (const [gap, char] of keystrokes) {
    gaps.push(gap);
    if (char === BACKSPACE) {
      buffer.pop();
      continue;
    }
    const pos = buffer.length;
    const expected = text[pos];
    buffer.push(char);
    // Keys typed past the end of the text have nothing to be compared against.
    if (expected === undefined) continue;

    increment(presses, expected);
    if (char !== expected) {
      increment(errors, `${expected}\u0000${char}`);
      if (pos > 0) increment(digraphs, text[pos - 1] + expected);
    }
  }

  const totalGapMs = gaps.reduce((a, b) => a + b, 0);
  const meanGapMs = gaps.length ? totalGapMs / gaps.length : 0;
  const variance = gaps.length
    ? gaps.reduce((a, g) => a + (g - meanGapMs) ** 2, 0) / gaps.length
    : 0;

  return {
    valid: true,
    replayed: buffer.join(''),
    count: keystrokes.length,
    totalGapMs,
    meanGapMs,
    gapCv: meanGapMs > 0 ? Math.sqrt(variance) / meanGapMs : 0,
    keyPresses: [...presses].map(([key, count]) => ({ key, count })),
    keyErrors: [...errors].map(([k, count]) => {
      const [expected, typed] = k.split('\u0000');
      return { expected, typed, count };
    }),
    digraphErrors: [...digraphs].map(([pair, count]) => ({ pair, count })),
  };
};

const isKeystroke = (entry) =>
  Array.isArray(entry) &&
  entry.length === 2 &&
  Number.isInteger(entry[0]) &&
  entry[0] >= 0 &&
  typeof entry[1] === 'string' &&
  entry[1].length === 1;

const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);
