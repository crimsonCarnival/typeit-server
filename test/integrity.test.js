import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessRun } from '../src/services/integrity.service.js';
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
      const run = cleanRun({ clientElapsedMs: 120_000, serverEndedAt: at(125_000) });
      assert.equal(assessRun(run).ranked, true);
    });

    it('flags a client claiming a much shorter run than the server measured', () => {
      const result = assessRun(cleanRun({ clientElapsedMs: 20_000, keystrokes: cleanKeystrokes({ totalGapMs: 19_000 }) }));
      assert.deepEqual(result.flags, [INTEGRITY_FLAGS.TIMING_MISMATCH]);
    });

    it('flags a client claiming a longer run than the server measured', () => {
      const result = assessRun(cleanRun({ clientElapsedMs: 40_000 }));
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
