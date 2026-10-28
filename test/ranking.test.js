import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Result from '../src/models/result.model.js';
import {
  clearRankingsCache,
  getRankings,
  rankEntries,
  regionFromTimezone,
  startOfUtcMonth,
} from '../src/services/ranking.service.js';
import { INTEGRITY_VERSION } from '../src/config/integrity.js';
import { RANKINGS_CACHE_TTL_MS } from '../src/config/rankings.js';

const day = (d) => new Date(`2026-10-${String(d).padStart(2, '0')}T12:00:00Z`);

describe('rankEntries', () => {
  it('orders by WPM, highest first', () => {
    const ranked = rankEntries([
      { id: 'a', wpm: 80, accuracy: 95, achievedAt: day(1) },
      { id: 'b', wpm: 120, accuracy: 90, achievedAt: day(1) },
    ]);
    assert.deepEqual(ranked.map((e) => [e.id, e.rank]), [['b', 1], ['a', 2]]);
  });

  it('breaks equal WPM by accuracy, then by who set it first', () => {
    const ranked = rankEntries([
      { id: 'late', wpm: 100, accuracy: 97, achievedAt: day(9) },
      { id: 'lowAcc', wpm: 100, accuracy: 95, achievedAt: day(1) },
      { id: 'early', wpm: 100, accuracy: 97, achievedAt: day(2) },
    ]);
    assert.deepEqual(ranked.map((e) => [e.id, e.rank]), [['early', 1], ['late', 2], ['lowAcc', 3]]);
  });

  it('gives fully tied players the same rank and skips the next one', () => {
    const ranked = rankEntries([
      { id: 'a', wpm: 100, accuracy: 97, achievedAt: day(1) },
      { id: 'b', wpm: 90, accuracy: 97, achievedAt: day(1) },
      { id: 'c', wpm: 90, accuracy: 97, achievedAt: day(1) },
      { id: 'd', wpm: 80, accuracy: 97, achievedAt: day(1) },
    ]);
    assert.deepEqual(ranked.map((e) => e.rank), [1, 2, 2, 4]);
  });

  it('does not mutate its input', () => {
    const input = [{ wpm: 1, accuracy: 1, achievedAt: day(1) }, { wpm: 2, accuracy: 1, achievedAt: day(1) }];
    rankEntries(input);
    assert.equal(input[0].wpm, 1);
    assert.equal('rank' in input[0], false);
  });
});

describe('regionFromTimezone', () => {
  it('maps IANA areas to regions', () => {
    assert.equal(regionFromTimezone('Europe/Madrid'), 'europe');
    assert.equal(regionFromTimezone('America/Argentina/Buenos_Aires'), 'americas');
    assert.equal(regionFromTimezone('Pacific/Auckland'), 'oceania');
  });

  it('returns null for zones with no region', () => {
    assert.equal(regionFromTimezone('Etc/UTC'), null);
    assert.equal(regionFromTimezone(null), null);
    assert.equal(regionFromTimezone(''), null);
  });
});

describe('startOfUtcMonth', () => {
  it('uses the UTC calendar month, not the server timezone', () => {
    assert.equal(startOfUtcMonth(new Date('2026-11-01T00:30:00+05:00')).toISOString(), '2026-10-01T00:00:00.000Z');
  });
});

describe('getRankings', () => {
  const ids = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId());
  const row = (i, wpm, timezone, extra = {}) => ({
    _id: ids[i],
    wpm,
    accuracy: 96,
    achievedAt: day(i + 1),
    user: { username: `p${i}`, displayName: '', avatar: '', timezone, stats: { raceWins: i } },
    ...extra,
  });
  const rows = [row(0, 110, 'Europe/Madrid'), row(1, 130, 'America/Lima'), row(2, 90, 'Europe/Paris'), row(3, 70, 'Etc/UTC')];
  const params = { period: 'all', mode: 'words', time: 60, modifiers: 'none', region: 'all', limit: 2 };
  let aggregate;

  beforeEach(() => {
    clearRankingsCache();
    aggregate = mock.method(Result, 'aggregate', async () => rows);
  });
  afterEach(() => mock.restoreAll());

  it('returns the top page, total count and the requester\'s own row', async () => {
    const data = await getRankings({ ...params, userId: ids[3] });
    assert.deepEqual(data.entries.map((e) => [e.username, e.rank]), [['p1', 1], ['p0', 2]]);
    assert.equal(data.totalPlayers, 4);
    assert.equal(data.me.username, 'p3');
    assert.equal(data.me.rank, 4);
  });

  it('never exposes region or timezone', async () => {
    const data = await getRankings(params);
    assert.equal('region' in data.entries[0], false);
    assert.equal('timezone' in data.entries[0], false);
    assert.equal(data.me, null);
  });

  it('re-ranks within a region', async () => {
    const data = await getRankings({ ...params, region: 'europe', userId: ids[2] });
    assert.deepEqual(data.entries.map((e) => [e.username, e.rank]), [['p0', 1], ['p2', 2]]);
    assert.equal(data.totalPlayers, 2);
    assert.equal(data.me.rank, 2);
  });

  it('only matches ranked runs under the current integrity rules', async () => {
    await getRankings({ ...params, period: 'month', modifiers: 'both' }, day(15));
    const [{ $match }] = aggregate.mock.calls[0].arguments[0];
    assert.equal($match.ranked, true);
    assert.deepEqual($match.integrityVersion, { $gte: INTEGRITY_VERSION });
    assert.equal($match.modifiers, 'both');
    assert.equal($match.createdAt.$gte.toISOString(), '2026-10-01T00:00:00.000Z');
  });

  it('serves a cached board until the TTL passes', async () => {
    const t0 = day(10);
    await getRankings(params, t0);
    await getRankings({ ...params, region: 'europe' }, new Date(t0.getTime() + RANKINGS_CACHE_TTL_MS));
    assert.equal(aggregate.mock.callCount(), 1);
    await getRankings(params, new Date(t0.getTime() + RANKINGS_CACHE_TTL_MS + 1));
    assert.equal(aggregate.mock.callCount(), 2);
  });
});
