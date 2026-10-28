import { MAX_KEYSTROKES } from '../config/integrity.js';
import {
  AFK_THRESHOLD_MS,
  BACKSPACE,
  CONSISTENCY_WARMUP_SECONDS,
  DEFAULT_RULES,
  DIFFICULTIES,
  PENALTIES,
  SKIP_CHAR,
  STOP_ON_ERROR,
} from '../config/gameplay.js';

/**
 * The run engine: the single place a typing run's numbers are computed.
 *
 * The client reports only what was pressed and when ([gapMs, char] pairs,
 * BACKSPACE for a deletion). `replayRun` types that log out against the
 * server's copy of the text under the run's rules (stop on error, space
 * skips word, spam blocking, penalties) and `computeResults` / `liveStats`
 * turn the replay into WPM, accuracy, consistency, score and per-second
 * samples. Pure functions: no I/O.
 */

/** Fills in defaults and drops combinations that contradict each other. */
export const normaliseRules = (rules = {}) => {
  const difficulty = DIFFICULTIES.includes(rules?.difficulty) ? rules.difficulty : DEFAULT_RULES.difficulty;
  const stopOnError = STOP_ON_ERROR.includes(rules?.stopOnError) ? rules.stopOnError : DEFAULT_RULES.stopOnError;
  // Skipping a word can't coexist with having to fix it first.
  const spaceSkips = stopOnError === 'off' && rules?.spaceSkips === true;
  return { difficulty, stopOnError, spaceSkips };
};

/** Rules plus the numbers the client needs to mirror input blocking. */
export const publicRules = (rules) => {
  const r = normaliseRules(rules);
  const p = PENALTIES[r.difficulty];
  return { ...r, spamRun: p.spamRun, backspaceEvery: p.backspaceEvery, backspaceSeconds: p.backspaceSeconds, backspacePoints: p.backspacePoints };
};

export const isKeystroke = (entry) =>
  Array.isArray(entry) &&
  entry.length === 2 &&
  Number.isInteger(entry[0]) &&
  entry[0] >= 0 &&
  typeof entry[1] === 'string' &&
  entry[1].length === 1;

/** Index of the word each position belongs to (a space belongs to the word before it). */
const wordIndexMap = (text) => {
  const map = new Int32Array(text.length);
  const spans = [];
  let word = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    map[i] = word;
    if (text[i] === ' ') {
      spans.push({ start, end: i });
      word++;
      start = i + 1;
    }
  }
  spans.push({ start, end: text.length });
  return { map, spans };
};

const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);

const EMPTY_REPLAY = Object.freeze({
  valid: false, typed: '', position: 0, correctChars: 0, typedChars: 0,
  correctKeys: 0, wrongKeys: 0, backspaces: 0, blocked: 0, skippedChars: 0,
  penalty: { points: 0, seconds: 0, backspace: 0, spam: 0 },
  afk: { ms: 0, periods: 0, marks: [] },
  words: [], timeline: [], count: 0, accepted: 0, totalGapMs: 0, meanGapMs: 0, gapCv: 0, lastT: 0,
  keyPresses: [], keyErrors: [], digraphErrors: [],
});

/**
 * Replays a keystroke log against the text.
 *
 * @param {string} text
 * @param {unknown} keystrokes        [[gapMs, char], ...]
 * @param {object} [rulesIn]           see config/gameplay.js
 * @param {object} [options]
 * @param {number} [options.leadMs]    time from the run's start to the first key (races)
 * @param {number} [options.timeMax]   seconds; keys after the (penalised) deadline are ignored
 */
export const replayRun = (text, keystrokes, rulesIn, { leadMs = 0, timeMax = null } = {}) => {
  if (typeof text !== 'string' || !Array.isArray(keystrokes) || keystrokes.length > MAX_KEYSTROKES) return EMPTY_REPLAY;
  if (!keystrokes.every(isKeystroke)) return EMPTY_REPLAY;

  const rules = normaliseRules(rulesIn);
  const pen = PENALTIES[rules.difficulty];
  const { map: wordOf, spans } = wordIndexMap(text);
  const words = spans.map(() => ({ errors: 0, firstAt: null, lastAt: null, skipped: false }));

  const buf = [];
  let correctChars = 0;
  let typedChars = 0;
  let correctKeys = 0;
  let wrongKeys = 0;
  let backspaces = 0;
  let blocked = 0;
  let skippedChars = 0;
  let sinceBackspacePenalty = 0;
  let lastWrongChar = null;
  let wrongRun = 0;
  const penalty = { points: 0, seconds: 0, backspace: 0, spam: 0 };
  const afk = { ms: 0, periods: 0, marks: [] };
  const presses = new Map();
  const errors = new Map();
  const digraphs = new Map();
  const timeline = [];
  const gaps = [];
  let t = 0;
  let accepted = 0;

  const pushChar = (char) => {
    const pos = buf.length;
    buf.push(char);
    if (char === SKIP_CHAR) return;
    typedChars++;
    if (char === text[pos]) correctChars++;
  };
  const popChar = () => {
    const pos = buf.length - 1;
    const char = buf.pop();
    if (char === SKIP_CHAR) {
      skippedChars--;
      return;
    }
    typedChars--;
    if (char === text[pos]) correctChars--;
  };
  const wordHasErrors = (w, upTo) => {
    for (let i = spans[w].start; i < upTo; i++) if (buf[i] !== text[i]) return true;
    return false;
  };
  const record = () => {
    timeline.push({ t, pos: buf.length, correct: correctChars, typed: typedChars, correctKeys, wrongKeys, backspaces });
  };

  for (const [gap, char] of keystrokes) {
    t += gap;
    if (timeMax !== null && leadMs + t > (timeMax - penalty.seconds) * 1000) break;
    accepted++;
    gaps.push(gap);

    if (char === BACKSPACE) {
      backspaces++;
      lastWrongChar = null;
      wrongRun = 0;
      if (buf.length) {
        popChar();
        // Land after the last real character, not inside a skipped stretch.
        while (buf.length && buf[buf.length - 1] === SKIP_CHAR) popChar();
      }
      if (++sinceBackspacePenalty >= pen.backspaceEvery) {
        sinceBackspacePenalty = 0;
        penalty.backspace++;
        penalty.points += pen.backspacePoints;
        penalty.seconds += pen.backspaceSeconds;
      }
      record();
      continue;
    }

    const pos = buf.length;
    if (pos >= text.length) continue; // nothing left to type
    const expected = text[pos];
    const w = wordOf[pos];

    if (accepted > 1 && gap > AFK_THRESHOLD_MS) {
      afk.ms += gap;
      afk.periods++;
      afk.marks.push(t);
    }

    // Mashing one wrong key: blocked from the spamRun-th press on.
    if (char !== expected) {
      if (char === lastWrongChar) wrongRun++;
      else { lastWrongChar = char; wrongRun = 1; }
      if (wrongRun >= pen.spamRun) {
        blocked++;
        penalty.spam++;
        penalty.points += pen.spamPoints;
        penalty.seconds += pen.spamSeconds;
        record();
        continue;
      }
    } else {
      lastWrongChar = null;
      wrongRun = 0;
    }

    words[w].firstAt ??= t;
    increment(presses, expected);

    // Space mid-word jumps to the next word; the rest of this one is missed.
    if (rules.spaceSkips && char === ' ' && expected !== ' ' && pos > 0 && buf[pos - 1] !== ' ') {
      const end = spans[w].end;
      for (let i = pos; i < end; i++) {
        pushChar(SKIP_CHAR);
        skippedChars++;
      }
      words[w].skipped = true;
      words[w].lastAt = t;
      if (end < text.length) pushChar(' ');
      correctKeys++;
      record();
      continue;
    }

    const wrong = char !== expected;
    const leavesBadWord = rules.stopOnError === 'word' && expected === ' ' && wordHasErrors(w, pos);
    if (wrong || leavesBadWord) {
      wrongKeys++;
      words[w].errors++;
      if (wrong) {
        increment(errors, `${expected}\u0000${char}`);
        if (pos > 0) increment(digraphs, text[pos - 1] + expected);
      }
      // A rejected key doesn't move the cursor.
      if (rules.stopOnError === 'letter' || leavesBadWord) {
        record();
        continue;
      }
    } else {
      correctKeys++;
    }
    pushChar(char);
    words[w].lastAt = t;
    record();
  }

  const totalGapMs = gaps.reduce((a, b) => a + b, 0);
  const meanGapMs = gaps.length ? totalGapMs / gaps.length : 0;
  const variance = gaps.length ? gaps.reduce((a, g) => a + (g - meanGapMs) ** 2, 0) / gaps.length : 0;

  return {
    valid: true,
    typed: buf.join(''),
    position: buf.length,
    correctChars,
    typedChars,
    correctKeys,
    wrongKeys,
    backspaces,
    blocked,
    skippedChars,
    penalty,
    afk,
    words: words.map((wd, i) => ({ ...wd, ...spans[i] })),
    timeline,
    count: keystrokes.length,
    accepted,
    totalGapMs,
    meanGapMs,
    gapCv: meanGapMs > 0 ? Math.sqrt(variance) / meanGapMs : 0,
    lastT: t,
    keyPresses: [...presses].map(([key, count]) => ({ key, count })),
    keyErrors: [...errors].map(([k, count]) => {
      const [expected, typed] = k.split('\u0000');
      return { expected, typed, count };
    }),
    digraphErrors: [...digraphs].map(([pair, count]) => ({ pair, count })),
  };
};

const perMinute = (chars, seconds) => (seconds > 0 ? Math.floor((chars / 5) * (60 / seconds)) : 0);
const accuracyOf = (correctKeys, wrongKeys) => {
  const keys = correctKeys + wrongKeys;
  return keys > 0 ? (correctKeys / keys) * 100 : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

/** Consistency: 100 minus the coefficient of variation (in %) of per-second speed. */
export const consistencyOf = (bursts) => {
  const values = bursts.length > CONSISTENCY_WARMUP_SECONDS + 1 ? bursts.slice(CONSISTENCY_WARMUP_SECONDS) : bursts;
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.max(0, 100 - (Math.sqrt(variance) / mean) * 100);
};

/** Timeline state at run time `ms` (from the run's start). */
const stateAt = (timeline, ms, leadMs) => {
  let lo = 0;
  let hi = timeline.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].t + leadMs <= ms) { found = timeline[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return found ?? { t: 0, pos: 0, correct: 0, typed: 0, correctKeys: 0, wrongKeys: 0, backspaces: 0 };
};

/**
 * Per-second samples for the results chart. Cumulative WPM/raw/accuracy at
 * each second, plus the burst (that second's raw speed) used for consistency.
 */
export const samplesOf = (replay, elapsedMs, leadMs = 0) => {
  const seconds = Math.max(1, Math.floor(elapsedMs / 1000));
  const samples = [];
  let highestWpm = 0;
  let prevTyped = 0;
  let prevBackspaces = 0;
  let afkIndex = 0;
  const bursts = [];
  for (let s = 1; s <= seconds; s++) {
    const st = stateAt(replay.timeline, s * 1000, leadMs);
    const wpm = perMinute(st.correct, s);
    const rawWpm = perMinute(st.typed, s);
    const burst = Math.max(0, (st.typed - prevTyped) * 12);
    bursts.push(burst);
    highestWpm = Math.max(highestWpm, wpm);
    const afkPeriods = [];
    while (afkIndex < replay.afk.marks.length && replay.afk.marks[afkIndex] + leadMs <= s * 1000) {
      afkIndex++;
      afkPeriods.push({ timestamp: s, afkIndex });
    }
    samples.push({
      timestamp: s,
      wpm,
      rawWpm,
      burst,
      accuracy: round2(accuracyOf(st.correctKeys, st.wrongKeys) || 100),
      currentIndex: st.pos,
      mistakes: st.wrongKeys,
      highestWpm,
      consistency: round2(consistencyOf(bursts)),
      backspaces: st.backspaces - prevBackspaces,
      afkPeriods,
    });
    prevTyped = st.typed;
    prevBackspaces = st.backspaces;
  }
  return samples;
};

/** Per-word breakdown for the results page (words the player reached). */
export const wordStatsOf = (text, replay) =>
  replay.words
    .filter((w) => w.firstAt !== null)
    .map((w) => {
      const ms = Math.max(0, (w.lastAt ?? w.firstAt) - w.firstAt);
      const len = w.end - w.start;
      return {
        word: text.slice(w.start, w.end),
        errors: w.errors,
        skipped: w.skipped,
        ms,
        wpm: ms > 0 ? Math.round((len / 5) * (60000 / ms)) : null,
      };
    });

/**
 * Final results of a run.
 * @param {object} run
 * @param {string} run.text
 * @param {number} run.totalWords
 * @param {number} run.timeMax      seconds
 * @param {object} replay           from replayRun
 * @param {number} elapsedMs        run duration (from the start to the end request)
 * @param {number} [leadMs]
 */
export const computeResults = (run, replay, elapsedMs, leadMs = 0) => {
  const limitMs = Math.max(1000, (run.timeMax - replay.penalty.seconds) * 1000);
  const ms = Math.min(Math.max(elapsedMs, 1000), limitMs);
  const elapsedSeconds = ms / 1000;
  const text = run.text;

  const cpm = Math.floor(replay.correctChars * (60 / elapsedSeconds)) || 0;
  const wpm = Math.floor(cpm / 5) || 0;
  const rawWpm = perMinute(replay.typedChars, elapsedSeconds);
  const accuracy = accuracyOf(replay.correctKeys, replay.wrongKeys);

  const requiredWPM = (run.totalWords * 60) / run.timeMax;
  const difficultyFactor = Math.min(Math.max(requiredWPM / 40, 0.25), 2.0);
  // Cubed accuracy rewards precision: 90% -> 0.73, 50% -> 0.125.
  const accuracyFactor = (accuracy / 100) ** 3;
  const score = Math.max(0, Math.round(replay.correctChars * (wpm / 10) * accuracyFactor * difficultyFactor) - replay.penalty.points);

  const performance = samplesOf(replay, ms, leadMs);
  const consistency = consistencyOf(performance.map((p) => p.burst));
  const highestWpm = performance.length ? Math.max(wpm, ...performance.map((p) => p.wpm)) : wpm;

  return {
    score,
    wpm,
    rawWpm,
    cpm,
    highestWpm,
    accuracy: round2(accuracy),
    mistakes: replay.wrongKeys,
    // Wrong keys per minute of the run.
    errorRate: Math.round((replay.wrongKeys / (elapsedSeconds / 60)) * 10) / 10,
    successes: replay.correctChars,
    missed: Math.max(0, text.length - replay.position) + replay.skippedChars,
    backspaces: replay.backspaces,
    elapsedTime: Math.floor(elapsedSeconds),
    completionPercentage: text.length ? round2(Math.min((replay.position / text.length) * 100, 100)) : 0,
    totalWords: run.totalWords,
    difficultyFactor: round2(difficultyFactor),
    remainingTime: Math.max(0, run.timeMax - replay.penalty.seconds - Math.floor(elapsedSeconds)),
    afkTime: replay.afk.ms / 1000,
    afkPeriods: replay.afk.periods,
    consistency: round2(consistency),
    penalty: { points: replay.penalty.points, seconds: replay.penalty.seconds },
    performance,
    wordStats: wordStatsOf(text, replay),
  };
};

/**
 * Numbers for the in-run display. `deadlineMs` is when time runs out
 * (measured from the run's start), already shortened by time penalties.
 */
export const liveStats = (run, replay, elapsedMs) => {
  const seconds = Math.max(elapsedMs / 1000, 1);
  const deadlineMs = Math.max(0, (run.timeMax - replay.penalty.seconds) * 1000);
  return {
    wpm: perMinute(replay.correctChars, seconds),
    rawWpm: perMinute(replay.typedChars, seconds),
    accuracy: round2(accuracyOf(replay.correctKeys, replay.wrongKeys)),
    mistakes: replay.wrongKeys,
    position: replay.position,
    completionPercentage: run.text.length ? round2(Math.min((replay.position / run.text.length) * 100, 100)) : 0,
    penalty: { points: replay.penalty.points, seconds: replay.penalty.seconds },
    deadlineMs,
    timeLeft: Math.max(0, Math.ceil((deadlineMs - elapsedMs) / 1000)),
  };
};
