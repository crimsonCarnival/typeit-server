import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateErrorMap, buildWeakKeysText, weakTargets, weekStart, weeklyTrends } from '../src/services/error-map.service.js';
import { buildReviewText, pairCounts, reviewOutcome } from '../src/services/review.service.js';
import { REVIEW_INTERVAL_DAYS, REVIEW_MAX_BOX, REVIEW_WORD_COUNT } from '../src/config/learn.js';
import { WEAK_WORD_COUNT } from '../src/config/error-map.js';
import { seededRandom } from '../src/utils/seeded-random.js';

const run = (presses, errors, digraphs = [], extra = {}) => ({
  keyPresses: Object.entries(presses).map(([key, count]) => ({ key, count })),
  keyErrors: Object.entries(errors).map(([k, count]) => ({ expected: k, typed: 'x', count })),
  digraphErrors: digraphs.map((pair) => ({ pair, count: 1 })),
  ...extra,
});

describe('weakTargets', () => {
  it('picks keys by error rate among keys pressed often enough', () => {
    const map = aggregateErrorMap([run({ a: 100, q: 30, z: 5, ' ': 200 }, { a: 5, q: 6, z: 4, ' ': 50 }, ['th', 'e '])]);
    const t = weakTargets(map);
    assert.deepEqual(t.keys, ['q', 'a']); // z too rare, space excluded
    assert.deepEqual(t.digraphs, ['th']);
  });
});

describe('buildWeakKeysText', () => {
  it('mixes words with weak targets into ordinary ones', () => {
    const pool = ['quiz', 'queen', 'then', 'apple', 'tree', 'moon', 'sun', 'lid'];
    const { text, totalWords } = buildWeakKeysText({ keys: ['q'], digraphs: ['th'] }, () => pool, seededRandom('w'));
    const words = text.split(' ');
    assert.equal(totalWords, WEAK_WORD_COUNT);
    const weak = words.filter((w) => w.includes('q') || w.includes('th')).length;
    assert.ok(weak > WEAK_WORD_COUNT * 0.4 && weak < WEAK_WORD_COUNT * 0.8, String(weak));
  });
});

describe('weeklyTrends', () => {
  it('buckets runs by UTC week (Monday start), oldest first, keeping empty weeks', () => {
    assert.equal(weekStart(new Date('2026-10-28T12:00:00Z')), '2026-10-26');
    assert.equal(weekStart(new Date('2026-10-26T00:00:00Z')), '2026-10-26');
    const now = new Date('2026-10-28T12:00:00Z');
    const runs = [
      run({ q: 40 }, { q: 8 }, [], { createdAt: new Date('2026-10-27T10:00:00Z'), wpm: 70 }),
      run({ q: 40 }, { q: 20 }, [], { createdAt: new Date('2026-10-13T10:00:00Z'), wpm: 50 }),
    ];
    const t = weeklyTrends(runs, 3, now);
    assert.deepEqual(t.weeks.map((w) => w.week), ['2026-10-12', '2026-10-19', '2026-10-26']);
    assert.deepEqual(t.weeks.map((w) => w.errorRate), [50, null, 20]);
    assert.deepEqual(t.weeks.map((w) => w.wpm), [50, null, 70]);
    assert.deepEqual(t.keys, ['q']);
    assert.equal(t.weeks[2].keys.q, 20);
  });
});

describe('digraph review', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const past = new Date('2026-10-27T00:00:00Z');
  const future = new Date('2026-11-05T00:00:00Z');

  it('counts letter pairs only', () => {
    assert.deepEqual([...pairCounts('the then.')], [['th', 2], ['he', 2], ['en', 1]]);
  });

  it('queues missed pairs and promotes due pairs typed cleanly', () => {
    const queue = [
      { pair: 'th', box: 1, dueAt: past },
      { pair: 'qu', box: 2, dueAt: future },
      { pair: 'er', box: REVIEW_MAX_BOX, dueAt: past },
      { pair: 'ab', box: 1, dueAt: past },
    ];
    const out = reviewOutcome(queue, { digraphErrors: [{ pair: 'ab', count: 1 }, { pair: 'e ', count: 1 }], typedText: 'the thin queen quit her very abacus ab' }, now);
    assert.deepEqual(out.missed, ['ab']);
    assert.deepEqual(out.promote.map((p) => [p.pair, p.box]), [['th', 2]]);
    assert.equal(out.promote[0].dueAt.getTime(), now.getTime() + REVIEW_INTERVAL_DAYS[2] * 86400000);
    assert.deepEqual(out.retire, ['er']);
  });

  it('builds review text from due pairs', () => {
    const pool = () => ['other', 'thin', 'quiet', 'quote', 'cat', 'dog'];
    const { text, totalWords } = buildReviewText(['th', 'qu'], pool);
    assert.ok(totalWords <= REVIEW_WORD_COUNT);
    assert.ok(text.split(' ').every((w) => w.includes('th') || w.includes('qu')));
    assert.equal(buildReviewText([], pool), null);
  });
});
