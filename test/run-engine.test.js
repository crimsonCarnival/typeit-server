import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeResults,
  consistencyOf,
  liveStats,
  normaliseRules,
  replayRun,
} from '../src/services/run-engine.js';
import { BACKSPACE, PENALTIES, SKIP_CHAR } from '../src/config/gameplay.js';

// Types `chars` one per `gap` ms ('<' is a backspace).
const log = (chars, gap = 200) =>
  [...chars].map((c, i) => [i === 0 ? 0 : gap, c === '<' ? BACKSPACE : c]);

const run = (text, overrides = {}) => ({ text, totalWords: text.split(' ').length, timeMax: 60, ...overrides });

describe('replayRun', () => {
  it('types the log out and counts correct and wrong keys', () => {
    const r = replayRun('the cat', log('thx<e cat'));
    assert.equal(r.typed, 'the cat');
    assert.equal(r.correctChars, 7);
    assert.equal(r.correctKeys, 7);
    assert.equal(r.wrongKeys, 1);
    assert.equal(r.backspaces, 1);
    assert.deepEqual(r.keyErrors, [{ expected: 'e', typed: 'x', count: 1 }]);
  });

  it('rejects a malformed log', () => {
    assert.equal(replayRun('ab', [[0, 'ab']]).valid, false);
    assert.equal(replayRun('ab', 'nope').valid, false);
  });

  describe('stop on error', () => {
    it("'letter' does not accept a wrong key", () => {
      const r = replayRun('cat', log('cxat'), { stopOnError: 'letter' });
      assert.equal(r.typed, 'cat');
      assert.equal(r.wrongKeys, 1);
    });

    it("'word' does not leave a word that has errors", () => {
      const r = replayRun('ab cd', log('ax cd'), { stopOnError: 'word' });
      // The space is refused, so 'cd' lands on ' c'.
      assert.equal(r.typed.slice(0, 2), 'ax');
      assert.notEqual(r.typed[2], ' ');
      const fixed = replayRun('ab cd', log('ax <b cd'), { stopOnError: 'word' });
      assert.equal(fixed.typed, 'ab cd');
    });
  });

  describe('space skips word', () => {
    it('jumps to the next word and marks the rest as skipped', () => {
      const r = replayRun('hello world', log('he world'), { spaceSkips: true });
      assert.equal(r.typed, `he${SKIP_CHAR.repeat(3)} world`);
      assert.equal(r.skippedChars, 3);
      assert.equal(r.words[0].skipped, true);
    });

    it('backspacing out of a skipped word lands after its last typed letter', () => {
      const r = replayRun('hello world', log('he <'), { spaceSkips: true });
      assert.equal(r.typed, 'he');
    });

    it('is off when stop-on-error is on', () => {
      assert.equal(normaliseRules({ spaceSkips: true, stopOnError: 'letter' }).spaceSkips, false);
    });
  });

  describe('penalties', () => {
    it('normal: heavy correcting costs a point, never time', () => {
      const keys = log('a<'.repeat(PENALTIES.normal.backspaceEvery));
      const r = replayRun('abc', keys);
      assert.deepEqual(r.penalty, { points: 1, seconds: 0, backspace: 1, spam: 0 });
    });

    it('hardcore: every 3 backspaces cost a point and a second', () => {
      const r = replayRun('abc', log('a<a<a<'), { difficulty: 'hardcore' });
      assert.deepEqual(r.penalty, { points: 1, seconds: 1, backspace: 1, spam: 0 });
    });

    it('blocks mashing one wrong key; only hardcore charges for it', () => {
      const normal = replayRun('abcdefgh', log('xxxxxx'));
      assert.equal(normal.typed, 'xxxx');
      assert.equal(normal.blocked, 2);
      assert.equal(normal.penalty.points, 0);
      const hard = replayRun('abcdefgh', log('xxxxxx'), { difficulty: 'hardcore' });
      assert.deepEqual([hard.penalty.points, hard.penalty.seconds], [2, 2]);
    });

    it('never blocks repeats the text itself asks for', () => {
      const r = replayRun('1000000', log('1000000'));
      assert.equal(r.typed, '1000000');
      assert.equal(r.blocked, 0);
    });

    it('ignores keys after a deadline shortened by time penalties', () => {
      // 3s limit, minus 1s penalty: keys after 2s don't count.
      const keys = [[0, 'a'], [100, BACKSPACE], [100, 'a'], [100, BACKSPACE], [100, 'a'], [100, BACKSPACE], [100, 'a'], [3000, 'b']];
      const r = replayRun('ab', keys, { difficulty: 'hardcore' }, { timeMax: 3 });
      assert.equal(r.typed, 'a');
    });
  });

  it('counts long pauses as away-from-keyboard', () => {
    const r = replayRun('abc', [[0, 'a'], [3000, 'b'], [100, 'c']]);
    assert.deepEqual([r.afk.periods, r.afk.ms], [1, 3000]);
  });
});

describe('computeResults', () => {
  it('derives speed from correct characters and the duration', () => {
    const text = 'the quick brown fox';
    const r = computeResults(run(text), replayRun(text, log(text, 100)), 60_000);
    assert.equal(r.successes, 19);
    assert.equal(r.cpm, 19);
    assert.equal(r.wpm, 3);
    assert.equal(r.accuracy, 100);
    assert.equal(r.completionPercentage, 100);
  });

  it('keeps backspaced errors in accuracy', () => {
    const r = computeResults(run('abcd'), replayRun('abcd', log('axb<<bcd')), 10_000);
    // 4 correct keys, 2 wrong ones ('x' and the first 'b' after it).
    assert.equal(r.mistakes, 2);
    assert.equal(r.accuracy, 66.67);
  });

  it('subtracts penalty points from the score', () => {
    const text = 'abc abc abc';
    const clean = computeResults(run(text), replayRun(text, log(text)), 10_000);
    const hard = computeResults(run(text), replayRun(text, log('a<a<a<' + text), { difficulty: 'hardcore' }), 10_000);
    assert.equal(hard.penalty.points, 1);
    assert.ok(hard.score < clean.score);
  });

  it('caps the scored duration at the time limit', () => {
    const r = computeResults(run('abc', { timeMax: 10 }), replayRun('abc', log('abc')), 30_000);
    assert.equal(r.elapsedTime, 10);
  });

  it('samples every second and reports words', () => {
    const text = 'aa bb';
    const r = computeResults(run(text), replayRun(text, log(text, 500)), 3_000);
    assert.equal(r.performance.length, 3);
    // Keys at 0, 0.5, 1, 1.5 and 2s.
    assert.deepEqual(r.performance.map((p) => p.currentIndex), [3, 5, 5]);
    assert.deepEqual(r.wordStats.map((w) => [w.word, w.errors]), [['aa', 0], ['bb', 0]]);
  });
});

describe('consistencyOf', () => {
  it('ignores the warm-up seconds', () => {
    assert.equal(consistencyOf([10, 30, 60, 60, 60, 60]), 100);
  });

  it('drops with uneven speed', () => {
    assert.ok(consistencyOf([60, 60, 20, 100, 20, 100]) < 50);
  });
});

describe('liveStats', () => {
  it('reports time left against the penalised deadline', () => {
    const replay = replayRun('abc', log('a<a<a<'), { difficulty: 'hardcore' });
    const live = liveStats(run('abc', { timeMax: 30 }), replay, 10_000);
    assert.equal(live.deadlineMs, 29_000);
    assert.equal(live.timeLeft, 19);
  });
});
