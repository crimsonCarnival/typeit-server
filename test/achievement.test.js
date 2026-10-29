import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Result from '../src/models/result.model.js';
import User from '../src/models/user.model.js';
import DailyAttempt from '../src/models/daily-attempt.model.js';
import UserAchievement from '../src/models/user-achievement.model.js';
import LessonProgress from '../src/models/lesson-progress.model.js';
import Race from '../src/models/race.model.js';
import {
  computeMetrics,
  evaluateAchievements,
  nextStreak,
  speedrunProgress,
  syncAchievements,
} from '../src/services/achievement.service.js';
import { ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_RARITIES } from '../src/config/achievements.js';

const byId = (list) => Object.fromEntries(list.map((a) => [a.id, a]));

/** Empty run and race history, shaped like the query chains the service uses. */
const mockHistory = (runs = [], races = []) => {
  const chain = (rows) => ({ sort: () => ({ limit: () => ({ select: () => ({ lean: async () => [...rows] }) }) }) });
  mock.method(Result, 'find', () => chain(runs));
  mock.method(Race, 'find', () => chain(races));
};

describe('achievement definitions', () => {
  it('has unique badges covering every category and rarity', () => {
    assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
    assert.deepEqual([...new Set(ACHIEVEMENTS.map((a) => a.category))].sort(), [...ACHIEVEMENT_CATEGORIES].sort());
    assert.deepEqual([...new Set(ACHIEVEMENTS.map((a) => a.rarity))].sort(), [...ACHIEVEMENT_RARITIES].sort());
  });

  it('keeps the original badge ids', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const id of ['first-run', 'warm-up', 'sixty-club', 'century', 'flawless', 'sharpshooter', 'steady-hand', 'week-streak', 'marathon', 'speedrun', 'daily-regular', 'race-winner']) {
      assert.ok(ids.has(id), id);
    }
  });

  it('numbers each family\'s tiers 1..n on one metric with rising targets', () => {
    const families = Map.groupBy(ACHIEVEMENTS.filter((a) => a.family), (a) => a.family);
    assert.ok(families.size >= 6);
    for (const [family, tiers] of families) {
      assert.deepEqual(tiers.map((t) => t.tier), tiers.map((_, i) => i + 1), family);
      assert.equal(new Set(tiers.map((t) => t.metric)).size, 1, family);
      for (let i = 1; i < tiers.length; i++) assert.ok(tiers[i].target > tiers[i - 1].target, family);
    }
  });
});

describe('tiers', () => {
  it('unlocks every tier the metric reaches', () => {
    const r = byId(evaluateAchievements({ raceWins: 12, lessonsPassed: 6, drillRuns: 9 }));
    assert.deepEqual([r['race-winner'].unlocked, r['race-ace'].unlocked, r['race-champion'].unlocked], [true, true, false]);
    assert.deepEqual([r['first-lesson'].unlocked, r.halfway.unlocked, r.graduate.unlocked], [true, true, false]);
    assert.equal(r.driller.unlocked, false);
  });
});

describe('evaluateAchievements', () => {
  it('unlocks exactly at the threshold, not one below', () => {
    const below = byId(evaluateAchievements({ bestWpm: 59 }));
    const at = byId(evaluateAchievements({ bestWpm: 60 }));
    assert.equal(below['sixty-club'].unlocked, false);
    assert.equal(below['warm-up'].unlocked, true);
    assert.equal(at['sixty-club'].unlocked, true);
    assert.equal(at.century.unlocked, false);
  });

  it('reports progress capped at the target', () => {
    const r = byId(evaluateAchievements({ bestWpm: 67, longestStreak: 2, raceWins: 3 }));
    assert.deepEqual([r.century.value, r['week-streak'].value, r['race-winner'].value], [67, 2, 1]);
  });

  it('treats missing metrics as zero', () => {
    assert.ok(evaluateAchievements({}).every((a) => a.value === 0 && !a.unlocked));
  });
});

describe('nextStreak', () => {
  it('starts at one', () => {
    assert.deepEqual(nextStreak(undefined, '2026-10-28'), { current: 1, longest: 1, lastDate: '2026-10-28' });
  });

  it('extends on consecutive days, across a month end', () => {
    const s = nextStreak({ current: 3, longest: 3, lastDate: '2026-10-31' }, '2026-11-01');
    assert.deepEqual(s, { current: 4, longest: 4, lastDate: '2026-11-01' });
  });

  it('ignores a second run on the same day', () => {
    const prev = { current: 4, longest: 6, lastDate: '2026-10-28' };
    assert.deepEqual(nextStreak(prev, '2026-10-28'), prev);
  });

  it('resets after a missed day but keeps the longest', () => {
    assert.deepEqual(nextStreak({ current: 5, longest: 6, lastDate: '2026-10-25' }, '2026-10-28'), {
      current: 1,
      longest: 6,
      lastDate: '2026-10-28',
    });
  });
});

describe('speedrunProgress', () => {
  it('is complete only with a qualifying run', () => {
    assert.equal(speedrunProgress(true, 0), 50);
    assert.equal(speedrunProgress(false, 300), 49);
  });

  it('otherwise reflects best pace over the window', () => {
    assert.equal(speedrunProgress(false, 82), 41); // 82 WPM -> 41 words in 30s
  });
});

describe('computeMetrics', () => {
  afterEach(() => mock.restoreAll());

  it('only scores performance badges on ranked runs', async () => {
    const agg = mock.method(Result, 'aggregate', async () => [
      { runs: 3, maxElapsed: 125, bestWpm: 71, flawlessRuns: 0, best60sAccuracy: 96, bestConsistency: 80, speedrun: 0, bestHardcoreWpm: 64, drillRuns: 4, listRuns: 1 },
    ]);
    mock.method(LessonProgress, 'find', () => ({ select: () => ({ lean: async () => [{ lessonId: 'home-left' }, { lessonId: 'common-words' }] }) }));
    mock.method(DailyAttempt, 'countDocuments', async () => 2);
    mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => ({ stats: { raceWins: 0, streak: { longest: 4 } } }) }) }));
    mockHistory();

    const { activeHours, ...history } = await computeMetrics(new mongoose.Types.ObjectId());
    assert.equal(activeHours, 0);
    // With no history, every history-based metric is zero.
    assert.ok(Object.values(history).filter((v) => typeof v === 'number').length > 20);
    const m = Object.fromEntries(Object.entries(history).filter(([k]) => ['runs', 'bestWpm', 'flawlessRuns', 'bestHardcoreWpm', 'drillRuns', 'listRuns', 'lessonsPassed', 'commonWordsPassed', 'best60sAccuracy', 'bestConsistency', 'longestRunMinutes', 'speedrunWords', 'longestStreak', 'dailiesFinished', 'raceWins'].includes(k)));
    assert.deepEqual(m, {
      runs: 3, bestWpm: 71, flawlessRuns: 0, bestHardcoreWpm: 64, drillRuns: 4, listRuns: 1, lessonsPassed: 1, commonWordsPassed: 1,
      best60sAccuracy: 96, bestConsistency: 80,
      longestRunMinutes: 2, speedrunWords: 35, longestStreak: 4, dailiesFinished: 2, raceWins: 0,
    });
    const group = agg.mock.calls[0].arguments[0][1].$group;
    assert.deepEqual(group.bestWpm, { $max: { $cond: ['$ranked', '$wpm', 0] } });
  });
});

describe('syncAchievements', () => {
  afterEach(() => mock.restoreAll());

  it('is idempotent: a second evaluation unlocks nothing new', async () => {
    const userId = new mongoose.Types.ObjectId();
    mock.method(Result, 'aggregate', async () => [{ runs: 1, bestWpm: 55, maxElapsed: 30 }]);
    mock.method(DailyAttempt, 'countDocuments', async () => 0);
    mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => ({ stats: {} }) }) }));
    mock.method(LessonProgress, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
    mockHistory();

    const stored = new Map();
    mock.method(UserAchievement, 'bulkWrite', async (ops) => {
      const upsertedIds = {};
      ops.forEach((op, i) => {
        const key = op.updateOne.filter.achievementId;
        if (!stored.has(key)) {
          stored.set(key, op.updateOne.update.$setOnInsert.unlockedAt);
          upsertedIds[i] = key;
        }
      });
      return { upsertedIds };
    });
    mock.method(UserAchievement, 'find', () => ({
      lean: async () => [...stored].map(([achievementId, unlockedAt]) => ({ achievementId, unlockedAt })),
    }));

    const first = await syncAchievements(userId, new Date('2026-10-28T10:00:00Z'));
    assert.deepEqual(first.newlyUnlocked.sort(), ['first-run', 'warm-up']);

    const second = await syncAchievements(userId, new Date('2026-10-29T10:00:00Z'));
    assert.deepEqual(second.newlyUnlocked, []);
    // The original unlock time is kept.
    assert.equal(byId(second.achievements)['warm-up'].unlockedAt.toISOString(), '2026-10-28T10:00:00.000Z');
    assert.equal('metric' in second.achievements[0], false);
  });
});
