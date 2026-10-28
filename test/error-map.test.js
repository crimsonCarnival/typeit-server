import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Result from '../src/models/result.model.js';
import { aggregateErrorMap, buildDrillText, getErrorMap } from '../src/services/error-map.service.js';
import { analyzeKeystrokes } from '../src/services/keystroke.service.js';
import { DRILL_WORD_COUNT, ERROR_MAP_DIGRAPH_LIMIT } from '../src/config/error-map.js';

const log = (chars) => [...chars].map((c, i) => [i ? 120 : 0, c]);

describe('aggregateErrorMap', () => {
  it('sums presses, errors and typed-instead across runs', () => {
    // Run 1: "thw" for "the" (e -> w). Run 2: "thr" for "the" (e -> r), "ab" ok.
    const runs = [analyzeKeystrokes(log('thw'), 'the'), analyzeKeystrokes(log('thr ab'), 'the ab')];
    const map = aggregateErrorMap(runs);
    const e = map.keys.find((k) => k.key === 'e');
    assert.equal(map.runs, 2);
    assert.equal(map.totalPresses, 9);
    assert.deepEqual({ presses: e.presses, errors: e.errors, errorRate: e.errorRate }, { presses: 2, errors: 2, errorRate: 100 });
    assert.deepEqual(e.typedInstead.map((t) => t.typed).sort(), ['r', 'w']);
    assert.deepEqual(map.digraphs, [{ pair: 'he', errors: 2 }]);
  });

  it('orders keys by error count, worst first', () => {
    const map = aggregateErrorMap([
      { keyPresses: [{ key: 'a', count: 10 }, { key: 'b', count: 10 }], keyErrors: [{ expected: 'b', typed: 'v', count: 3 }] },
    ]);
    assert.deepEqual(map.keys.map((k) => k.key), ['b', 'a']);
    assert.equal(map.keys[0].errorRate, 30);
  });

  it('sorts typed-instead by frequency', () => {
    const map = aggregateErrorMap([
      {
        keyPresses: [{ key: 'e', count: 20 }],
        keyErrors: [
          { expected: 'e', typed: 'w', count: 1 },
          { expected: 'e', typed: 'r', count: 4 },
        ],
      },
    ]);
    assert.deepEqual(map.keys[0].typedInstead, [{ typed: 'r', count: 4 }, { typed: 'w', count: 1 }]);
  });

  it('caps the digraph list', () => {
    const digraphErrors = Array.from({ length: 30 }, (_, i) => ({ pair: `a${String.fromCharCode(97 + (i % 26))}${i}`, count: i + 1 }));
    assert.equal(aggregateErrorMap([{ digraphErrors }]).digraphs.length, ERROR_MAP_DIGRAPH_LIMIT);
  });

  it('handles no data', () => {
    assert.deepEqual(aggregateErrorMap([]), { runs: 0, totalPresses: 0, keys: [], digraphs: [] });
  });
});

describe('getErrorMap', () => {
  afterEach(() => mock.restoreAll());

  it('reads only the most recent runs that carry key data', async () => {
    const chain = { sort: () => chain, limit: () => chain, select: () => chain, lean: async () => [] };
    const find = mock.method(Result, 'find', () => chain);
    const limit = mock.method(chain, 'limit', () => chain);
    await getErrorMap(new mongoose.Types.ObjectId(), 8);
    assert.deepEqual(find.mock.calls[0].arguments[0]['keyPresses.0'], { $exists: true });
    assert.equal(limit.mock.calls[0].arguments[0], 8);
  });
});

describe('buildDrillText', () => {
  const words = () => ['apple', 'the', 'queen', 'sun', 'there', 'map', 'go', 'feather'];

  it('uses only words containing the key', () => {
    const { text, totalWords } = buildDrillText('e', words);
    assert.equal(totalWords, DRILL_WORD_COUNT);
    assert.ok(text.split(' ').every((w) => w.includes('e')));
  });

  it('drills digraphs', () => {
    assert.ok(buildDrillText('th', words).text.split(' ').every((w) => w.includes('th')));
  });

  it('drills space with short words', () => {
    assert.ok(buildDrillText(' ', words).text.split(' ').every((w) => w.length <= 4));
  });

  it('falls back to any words when none contain the target', () => {
    assert.equal(buildDrillText('z', words).totalWords, DRILL_WORD_COUNT);
  });
});
