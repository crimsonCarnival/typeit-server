import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeKeystrokes, BACKSPACE } from '../src/services/keystroke.service.js';
import { MAX_KEYSTROKES } from '../src/config/integrity.js';

// Builds a log typing `chars` one by one with the given gaps (cycled).
const log = (chars, gaps = [120, 180, 90]) =>
  [...chars].map((c, i) => [i === 0 ? 0 : gaps[i % gaps.length], c]);

const find = (list, pred) => list.find(pred)?.count;

describe('analyzeKeystrokes', () => {
  it('replays a clean log to the typed text with no errors', () => {
    const a = analyzeKeystrokes(log('the cat'), 'the cat sat');
    assert.equal(a.valid, true);
    assert.equal(a.replayed, 'the cat');
    assert.equal(a.count, 7);
    assert.deepEqual(a.keyErrors, []);
    assert.equal(find(a.keyPresses, (p) => p.key === 't'), 2);
  });

  it('derives the expected key from the text, not from the client', () => {
    // Typed "thw" where the text says "the": expected 'e', typed 'w'.
    const a = analyzeKeystrokes(log('thw'), 'the');
    assert.deepEqual(a.keyErrors, [{ expected: 'e', typed: 'w', count: 1 }]);
    assert.deepEqual(a.digraphErrors, [{ pair: 'he', count: 1 }]);
  });

  it('counts a corrected error and replays the correction', () => {
    const keys = [[0, 't'], [100, 'x'], [150, BACKSPACE], [120, 'h'], [110, 'e']];
    const a = analyzeKeystrokes(keys, 'the');
    assert.equal(a.replayed, 'the');
    assert.deepEqual(a.keyErrors, [{ expected: 'h', typed: 'x', count: 1 }]);
    // The retyped 'h' is a second press of that key.
    assert.equal(find(a.keyPresses, (p) => p.key === 'h'), 2);
  });

  it('keeps punctuation keys that Mongo map keys could not hold', () => {
    const a = analyzeKeystrokes(log('a,'), 'a.');
    assert.deepEqual(a.keyErrors, [{ expected: '.', typed: ',', count: 1 }]);
  });

  it('ignores keys typed past the end of the text', () => {
    const a = analyzeKeystrokes(log('abcd'), 'ab');
    assert.equal(a.replayed, 'ab');
    assert.deepEqual(a.keyErrors, []);
    assert.equal(a.keyPresses.reduce((n, p) => n + p.count, 0), 2);
  });

  it('measures gap timing and variation', () => {
    const constant = analyzeKeystrokes([[100, 'a'], [100, 'b'], [100, 'c']], 'abc');
    assert.equal(constant.totalGapMs, 300);
    assert.equal(constant.meanGapMs, 100);
    assert.equal(constant.gapCv, 0);
    const varied = analyzeKeystrokes([[50, 'a'], [150, 'b'], [100, 'c']], 'abc');
    assert.ok(varied.gapCv > 0.3);
  });

  it('rejects malformed logs', () => {
    for (const bad of [
      'abc',
      [[10, 'ab']],
      [[-1, 'a']],
      [[1.5, 'a']],
      [['10', 'a']],
      [[10]],
    ]) {
      assert.equal(analyzeKeystrokes(bad, 'abc').valid, false, JSON.stringify(bad));
    }
  });

  it('rejects logs over the size cap', () => {
    const tooLong = Array.from({ length: MAX_KEYSTROKES + 1 }, () => [100, 'a']);
    assert.equal(analyzeKeystrokes(tooLong, 'a'.repeat(10)).valid, false);
  });
});
