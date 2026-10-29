import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Result from '../src/models/result.model.js';
import User from '../src/models/user.model.js';
import { PB_TIME_LIMITS, PB_WORD_COUNTS, RESULT_ROWS_LIMIT, activityWindow, getProfileOverview, getResultRows, toRow } from '../src/services/stats.service.js';

const leanOf = (value) => ({ select() { return this; }, lean: async () => value });
const id = () => new mongoose.Types.ObjectId();

describe('activityWindow', () => {
  const now = new Date('2026-10-28T15:30:00Z');

  it('is the last twelve months ending with today, in UTC days', () => {
    const w = activityWindow(now);
    assert.equal(w.year, null);
    assert.equal(w.to.toISOString(), '2026-10-29T00:00:00.000Z', 'includes all of today');
    assert.equal((w.to - w.from) / 86_400_000, 365);
  });

  it('is a whole calendar year when one is asked for', () => {
    const w = activityWindow(now, 2025);
    assert.equal(w.from.toISOString(), '2025-01-01T00:00:00.000Z');
    assert.equal(w.to.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(w.year, 2025);
  });

  it('ignores a year that is nonsense or in the future', () => {
    for (const bad of [1999, 2027, 2025.5, NaN, '2025']) assert.equal(activityWindow(now, bad).year, null, String(bad));
  });

  it('puts a test run just after UTC midnight on the new day, not the old one', () => {
    const w = activityWindow(new Date('2026-10-28T00:00:01Z'));
    assert.equal(w.to.toISOString(), '2026-10-29T00:00:00.000Z');
  });
});

describe('toRow', () => {
  const doc = { _id: id(), createdAt: new Date('2026-01-02T03:04:05Z'), wpm: 61.5, rawWpm: 63, accuracy: 96, consistency: 70, elapsedTime: 75, timeMax: 60, gameMode: 'words', wordCount: 50, modifiers: 'numbers', language: 'english', ranked: true, successes: 300, mistakes: 7, backspaces: 4, flagged: false, hasLog: true };

  it('maps a result to the short form the dashboard uses', () => {
    assert.deepEqual(toRow(doc), {
      id: String(doc._id), t: Date.UTC(2026, 0, 2, 3, 4, 5), wpm: 61.5, raw: 63, acc: 96, cons: 70, secs: 60,
      mode: 'words', timeMax: 60, words: 50, mods: 'numbers', lang: 'english', verified: true, flagged: false,
      practice: null, daily: false, correct: 300, incorrect: 7, backspaces: 4, replay: true,
    });
  });

  it('typing time never exceeds the test\'s own limit', () => {
    assert.equal(toRow({ ...doc, elapsedTime: 600, timeMax: 60 }).secs, 60);
    assert.equal(toRow({ ...doc, elapsedTime: -5 }).secs, 0);
  });

  it('copes with older results that lack newer fields', () => {
    const old = toRow({ _id: id(), createdAt: new Date(0), wpm: 40, accuracy: 90, gameMode: 'words' });
    assert.deepEqual([old.raw, old.cons, old.mods, old.lang, old.verified, old.flagged, old.replay, old.correct], [40, 0, 'none', null, false, false, false, 0]);
  });

  it('marks practice and daily results', () => {
    assert.equal(toRow({ ...doc, practiceKind: 'drill' }).practice, 'drill');
    assert.equal(toRow({ ...doc, dailyDate: '2026-01-02' }).daily, true);
  });
});

describe('getResultRows', () => {
  afterEach(() => mock.restoreAll());

  it('returns the newest results oldest first, capped', async () => {
    let stages;
    mock.method(Result, 'aggregate', async (s) => {
      stages = s;
      return [
        { _id: id(), createdAt: new Date('2026-03-01'), wpm: 70 },
        { _id: id(), createdAt: new Date('2026-02-01'), wpm: 60 },
      ];
    });
    const rows = await getResultRows(id(), 10_000);
    assert.deepEqual(rows.map((r) => r.wpm), [60, 70], 'oldest first');
    assert.equal(stages.find((s) => s.$limit).$limit, RESULT_ROWS_LIMIT, 'never more than the cap');
    assert.deepEqual(stages.find((s) => s.$sort).$sort, { createdAt: -1 });
  });

  it('only reads the given player\'s results', async () => {
    let match;
    mock.method(Result, 'aggregate', async (s) => {
      match = s[0].$match;
      return [];
    });
    const userId = id();
    await getResultRows(userId);
    assert.equal(String(match.userId), String(userId));
  });
});

describe('getProfileOverview', () => {
  afterEach(() => mock.restoreAll());
  const now = new Date('2026-10-28T12:00:00Z');

  const stub = (facets, started = 0) => {
    mock.method(Result, 'aggregate', async () => [facets]);
    mock.method(User, 'findById', () => leanOf({ stats: { testsStarted: started } }));
  };

  it('totals: started, completed with its rate, restarts, time typing and estimated words', async () => {
    stub({ totals: [{ completed: 8, seconds: 562, correct: 2535, first: new Date('2025-11-02') }], activity: [], pbTime: [], pbWords: [] }, 10);
    const { totals } = await getProfileOverview(id(), { now });
    assert.deepEqual(totals, { started: 10, completed: 8, completionRate: 80, restartsPerTest: 0.3, timeTyping: 562, estimatedWords: 507 });
  });

  it('never reports fewer starts than finished tests (accounts from before starts were counted)', async () => {
    stub({ totals: [{ completed: 40, seconds: 1, correct: 0, first: new Date('2026-01-01') }], activity: [], pbTime: [], pbWords: [] }, 0);
    const { totals } = await getProfileOverview(id(), { now });
    assert.deepEqual([totals.started, totals.completionRate, totals.restartsPerTest], [40, 100, 0]);
  });

  it('a new account has no rates to show', async () => {
    stub({ totals: [], activity: [], pbTime: [], pbWords: [] });
    const out = await getProfileOverview(id(), { now });
    assert.deepEqual([out.totals.started, out.totals.completionRate, out.totals.restartsPerTest, out.totals.estimatedWords], [0, null, null, 0]);
  });

  it('has a personal-best slot per preset, null where there is none', async () => {
    stub({ totals: [], activity: [], pbTime: [{ _id: 60, wpm: 77, accuracy: 97 }], pbWords: [{ _id: 100, wpm: 62, accuracy: 96 }, { _id: 10, wpm: 43, accuracy: 87 }] });
    const { personalBests } = await getProfileOverview(id(), { now });
    assert.equal(personalBests.time.length, PB_TIME_LIMITS.length);
    assert.deepEqual(personalBests.time.map((s) => s && s.limit), [null, null, 60, null, null]);
    assert.deepEqual(personalBests.time[2], { limit: 60, wpm: 77, accuracy: 97 });
    assert.equal(personalBests.words.length, PB_WORD_COUNTS.length);
    assert.deepEqual(personalBests.words.map((s) => s && s.wpm), [43, null, null, null, 62]);
  });

  it('personal bests skip practice, daily and flagged results, and unfinished word tests', async () => {
    let facets;
    mock.method(Result, 'aggregate', async (stages) => {
      facets = stages.find((s) => s.$facet).$facet;
      return [{}];
    });
    mock.method(User, 'findById', () => leanOf(null));
    await getProfileOverview(id(), { now });
    for (const key of ['pbTime', 'pbWords']) {
      const m = facets[key][0].$match;
      assert.equal(m.practiceKind, null);
      assert.equal(m.dailyDate, null);
      assert.equal(m.failed, false);
    }
    assert.deepEqual(facets.pbWords[0].$match.completionPercentage, { $gte: 100 });
  });

  it('activity: tests per UTC day inside the window, with a total and the years to pick from', async () => {
    stub({
      totals: [{ completed: 3, seconds: 1, correct: 1, first: new Date('2024-05-01') }],
      activity: [{ _id: '2026-10-27', count: 2 }, { _id: '2026-10-28', count: 1 }],
      pbTime: [],
      pbWords: [],
    });
    const { activity } = await getProfileOverview(id(), { now });
    assert.deepEqual(activity.days, [{ date: '2026-10-27', count: 2 }, { date: '2026-10-28', count: 1 }]);
    assert.equal(activity.total, 3);
    assert.deepEqual(activity.years, [2026, 2025, 2024]);
    assert.equal(activity.year, null);
  });

  it('asks the database only for results inside the window', async () => {
    let facets;
    mock.method(Result, 'aggregate', async (stages) => {
      facets = stages.find((s) => s.$facet).$facet;
      return [{}];
    });
    mock.method(User, 'findById', () => leanOf(null));
    await getProfileOverview(id(), { year: 2025, now });
    const range = facets.activity[0].$match.createdAt;
    assert.equal(range.$gte.toISOString(), '2025-01-01T00:00:00.000Z');
    assert.equal(range.$lt.toISOString(), '2026-01-01T00:00:00.000Z');
  });
});
