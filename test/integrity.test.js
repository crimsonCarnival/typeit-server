import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessRun } from '../src/services/integrity.service.js';
import { calculateResults } from '../src/services/game.service.js';
import { INTEGRITY_FLAGS, INTEGRITY_VERSION, MAX_PLAUSIBLE_WPM } from '../src/config/integrity.js';

const START = new Date('2026-10-28T12:00:00Z');
const at = (ms) => new Date(START.getTime() + ms);

// Shape of analyzeKeystrokes() output for a human-looking 30s log.
const cleanKeystrokes = (overrides = {}) => ({
  valid: true,
  replayed: 'typed text',
  count: 180,
  totalGapMs: 29_000,
  meanGapMs: 161,
  gapCv: 0.55,
  ...overrides,
});

// A clean 30s run: server and client agree, sane speed, ordered samples.
const cleanRun = (overrides = {}) => ({
  textSource: 'server',
  serverStartedAt: START,
  serverEndedAt: at(30_400),
  clientElapsedMs: 30_000,
  wpm: 72,
  rawWpm: 75,
  textLength: 300,
  performance: [
    { timestamp: 1, currentIndex: 6 },
    { timestamp: 2, currentIndex: 13 },
    { timestamp: 30, currentIndex: 180 },
  ],
  typedText: 'typed text',
  keystrokes: cleanKeystrokes(),
  ...overrides,
});

describe('assessRun', () => {
  it('ranks a clean run and stamps the current rules version', () => {
    const result = assessRun(cleanRun());
    assert.deepEqual(result, { ranked: true, flags: [], integrityVersion: INTEGRITY_VERSION });
  });

  it('never ranks text the client supplied', () => {
    const result = assessRun(cleanRun({ textSource: 'client' }));
    assert.equal(result.ranked, false);
    assert.deepEqual(result.flags, [INTEGRITY_FLAGS.CLIENT_TEXT]);
  });

  it('treats a missing text source as client text', () => {
    assert.deepEqual(assessRun(cleanRun({ textSource: undefined })).flags, [INTEGRITY_FLAGS.CLIENT_TEXT]);
  });

  it('does not rank a run the server never saw begin', () => {
    const result = assessRun(cleanRun({ serverStartedAt: null }));
    assert.deepEqual(result.flags, [INTEGRITY_FLAGS.NO_SERVER_START]);
  });

  describe('timing', () => {
    it('accepts latency within the 2s floor', () => {
      assert.equal(assessRun(cleanRun({ serverEndedAt: at(31_900) })).ranked, true);
    });

    it('accepts latency within 5% on long runs', () => {
      // 120s run: tolerance is 6s, so a 5s gap passes.
      const run = cleanRun({ clientElapsedMs: 120_000, serverEndedAt: at(125_000), performance: [] });
      assert.equal(assessRun(run).ranked, true);
    });

    it('flags a client claiming a much shorter run than the server measured', () => {
      const result = assessRun(cleanRun({ clientElapsedMs: 20_000, performance: [], keystrokes: cleanKeystrokes({ totalGapMs: 19_000 }) }));
      assert.deepEqual(result.flags, [INTEGRITY_FLAGS.TIMING_MISMATCH]);
    });

    it('flags a client claiming a longer run than the server measured', () => {
      const result = assessRun(cleanRun({ clientElapsedMs: 40_000, performance: [] }));
      assert.deepEqual(result.flags, [INTEGRITY_FLAGS.TIMING_MISMATCH]);
    });
  });

  describe('speed cap', () => {
    it('accepts exactly the maximum plausible WPM', () => {
      assert.equal(assessRun(cleanRun({ wpm: MAX_PLAUSIBLE_WPM, rawWpm: MAX_PLAUSIBLE_WPM })).ranked, true);
    });

    it('flags net WPM above the cap', () => {
      const result = assessRun(cleanRun({ wpm: MAX_PLAUSIBLE_WPM + 1 }));
      assert.deepEqual(result.flags, [INTEGRITY_FLAGS.IMPLAUSIBLE_WPM]);
    });

    it('flags raw WPM above the cap even when net WPM is fine', () => {
      const result = assessRun(cleanRun({ rawWpm: MAX_PLAUSIBLE_WPM + 1 }));
      assert.deepEqual(result.flags, [INTEGRITY_FLAGS.IMPLAUSIBLE_WPM]);
    });
  });

  describe('performance samples', () => {
    const flagsFor = (performance) => assessRun(cleanRun({ performance })).flags;

    it('accepts no samples', () => {
      assert.deepEqual(flagsFor([]), []);
    });

    it('accepts a backspace that moves the index backwards', () => {
      assert.deepEqual(flagsFor([{ timestamp: 1, currentIndex: 10 }, { timestamp: 2, currentIndex: 8 }]), []);
    });

    it('flags samples that go back in time', () => {
      const flags = flagsFor([{ timestamp: 5, currentIndex: 10 }, { timestamp: 3, currentIndex: 12 }]);
      assert.deepEqual(flags, [INTEGRITY_FLAGS.PERFORMANCE_INCONSISTENT]);
    });

    it('flags samples after the run ended', () => {
      assert.deepEqual(flagsFor([{ timestamp: 45, currentIndex: 10 }]), [INTEGRITY_FLAGS.PERFORMANCE_INCONSISTENT]);
    });

    it('flags samples past the end of the text', () => {
      assert.deepEqual(flagsFor([{ timestamp: 1, currentIndex: 301 }]), [INTEGRITY_FLAGS.PERFORMANCE_INCONSISTENT]);
    });

    it('flags malformed samples', () => {
      assert.deepEqual(flagsFor([{ timestamp: '1', currentIndex: 3 }]), [INTEGRITY_FLAGS.PERFORMANCE_INCONSISTENT]);
      assert.deepEqual(flagsFor([null]), [INTEGRITY_FLAGS.PERFORMANCE_INCONSISTENT]);
      assert.deepEqual(flagsFor('not-an-array'), [INTEGRITY_FLAGS.PERFORMANCE_INCONSISTENT]);
    });
  });

  describe('keystroke log', () => {
    const flagsFor = (keystrokes, extra = {}) => assessRun(cleanRun({ keystrokes, ...extra })).flags;

    it('does not rank a run without a log (older clients)', () => {
      assert.deepEqual(flagsFor(null), [INTEGRITY_FLAGS.NO_KEYSTROKES]);
      assert.deepEqual(flagsFor(cleanKeystrokes({ count: 0 })), [INTEGRITY_FLAGS.NO_KEYSTROKES]);
    });

    it('flags a malformed log', () => {
      assert.deepEqual(flagsFor(cleanKeystrokes({ valid: false })), [INTEGRITY_FLAGS.KEYSTROKES_INCONSISTENT]);
    });

    it('flags a log that does not replay to the submitted text', () => {
      assert.deepEqual(flagsFor(cleanKeystrokes({ replayed: 'other text' })), [INTEGRITY_FLAGS.KEYSTROKES_INCONSISTENT]);
    });

    it('flags a log that spans longer than the run', () => {
      assert.deepEqual(flagsFor(cleanKeystrokes({ totalGapMs: 32_001 })), [INTEGRITY_FLAGS.KEYSTROKES_INCONSISTENT]);
    });

    it('flags near-constant gaps as scripted', () => {
      assert.deepEqual(flagsFor(cleanKeystrokes({ gapCv: 0.05 })), [INTEGRITY_FLAGS.ROBOTIC_TIMING]);
    });

    it('flags an average gap faster than a human hand', () => {
      assert.deepEqual(flagsFor(cleanKeystrokes({ meanGapMs: 10 })), [INTEGRITY_FLAGS.ROBOTIC_TIMING]);
    });

    it('skips rhythm checks on very short logs', () => {
      assert.deepEqual(flagsFor(cleanKeystrokes({ count: 20, gapCv: 0 })), []);
    });
  });

  it('reports every failed rule at once', () => {
    const result = assessRun(cleanRun({ textSource: 'client', serverStartedAt: null, wpm: 400 }));
    assert.deepEqual(result.flags, [
      INTEGRITY_FLAGS.CLIENT_TEXT,
      INTEGRITY_FLAGS.NO_SERVER_START,
      INTEGRITY_FLAGS.IMPLAUSIBLE_WPM,
    ]);
    assert.equal(result.ranked, false);
  });
});

describe('calculateResults (server-side scoring)', () => {
  const session = { text: 'the quick brown fox', totalWords: 4, timeMax: 30 };
  // Clients send Date.now() values; a 0 start would hit the falsy fallback.
  const T0 = START.getTime();

  it('scores only characters that match the session text', () => {
    // 60s run, 10 correct of 12 typed chars -> 10 cpm, 2 wpm.
    const r = calculateResults(session, 'the quick xx', T0, T0 + 60_000);
    assert.equal(r.successes, 10);
    assert.equal(r.mistakes, 2);
    assert.equal(r.cpm, 10);
    assert.equal(r.wpm, 2);
  });

  it('uses raw keystrokes so backspaced errors still cost accuracy', () => {
    // 9 correct chars on screen, but 12 keys were pressed in total.
    const r = calculateResults(session, 'the quick', T0, T0 + 10_000, 0, 0, [], 0, 12);
    assert.equal(r.mistakes, 3);
    assert.equal(r.accuracy, 75);
  });

  it('derives WPM from the reported duration, which is why timing must be checked', () => {
    const honest = calculateResults(session, 'the quick brown fox', T0, T0 + 10_000);
    const forged = calculateResults(session, 'the quick brown fox', T0, T0 + 2_000);
    assert.ok(forged.wpm > honest.wpm * 4);
  });
});
