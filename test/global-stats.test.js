import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import Result from '../src/models/result.model.js';
import User from '../src/models/user.model.js';
import { clearGlobalStatsCache, getGlobalStats, toBands } from '../src/services/global-stats.service.js';

describe('toBands', () => {
  it('counts players per 10-WPM band, from 0 to the fastest', () => {
    assert.deepEqual(toBands([5, 42, 49.9, 61]).map((b) => [b.from, b.players]), [[0, 1], [10, 0], [20, 0], [30, 0], [40, 2], [50, 0], [60, 1]]);
    assert.deepEqual(toBands([]), []);
  });
});

describe('getGlobalStats', () => {
  afterEach(() => {
    mock.restoreAll();
    clearGlobalStatsCache();
  });

  const stub = (optedOut = []) => {
    let call = 0;
    mock.method(Result, 'aggregate', async () => (call++ === 0 ? [{ completed: 10, seconds: 600.4 }] : [{ _id: 'a', wpm: 55 }, { _id: 'b', wpm: 72 }]));
    mock.method(User, 'aggregate', async () => [{ started: 7, players: 3 }]);
    mock.method(User, 'find', () => ({ select: () => ({ lean: async () => optedOut.map((_id) => ({ _id })) }) }));
  };

  it('totals tests and typing time, never fewer starts than finishes', async () => {
    stub();
    const out = await getGlobalStats(0);
    assert.deepEqual([out.players, out.started, out.completed, out.seconds], [3, 10, 10, 600]);
    assert.equal(out.distribution.results, 2);
  });

  it('leaves players who opted out of leaderboards out of the distribution', async () => {
    stub(['b']);
    const out = await getGlobalStats(0);
    assert.equal(out.distribution.results, 1);
  });

  it('is cached for ten minutes', async () => {
    stub();
    await getGlobalStats(0);
    await getGlobalStats(60_000);
    assert.equal(User.aggregate.mock.callCount(), 1);
    await getGlobalStats(11 * 60_000);
    assert.equal(User.aggregate.mock.callCount(), 2);
  });
});
