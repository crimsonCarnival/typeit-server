import mongoose from 'mongoose';
import Result from '../models/result.model.js';
import User from '../models/user.model.js';
import DailyAttempt from '../models/daily-attempt.model.js';
import UserAchievement from '../models/user-achievement.model.js';
import {
  ACHIEVEMENTS,
  FLAWLESS_MIN_CORRECT_CHARS,
  SPEEDRUN_SECONDS,
  SPEEDRUN_WORDS,
} from '../config/achievements.js';
import { dateKey } from './daily.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Advances a day streak for a run played on `today` ('YYYY-MM-DD', UTC).
 * Playing twice on one day changes nothing, so re-evaluating is harmless.
 */
export const nextStreak = (prev, today) => {
  const { current = 0, longest = 0, lastDate = null } = prev || {};
  if (lastDate === today) return { current, longest, lastDate };
  const yesterday = dateKey(new Date(Date.parse(today) - DAY_MS));
  const next = lastDate === yesterday ? current + 1 : 1;
  return { current: next, longest: Math.max(longest, next), lastDate: today };
};

/**
 * Speedrun progress in words: the target once a qualifying run exists,
 * otherwise how many words the player's best verified pace covers in the
 * time window (never shown as complete without a real qualifying run).
 */
export const speedrunProgress = (qualified, bestWpm) =>
  qualified ? SPEEDRUN_WORDS : Math.min(SPEEDRUN_WORDS - 1, Math.floor((bestWpm * SPEEDRUN_SECONDS) / 60));

/**
 * Maps a player's metrics to every badge's progress. Pure.
 * @param {Record<string, number>} metrics
 */
export const evaluateAchievements = (metrics) =>
  ACHIEVEMENTS.map((a) => {
    const value = metrics[a.metric] ?? 0;
    return { id: a.id, value: Math.min(value, a.target), unlocked: value >= a.target };
  });

/** Reads every metric the badges need, in three queries. */
export const computeMetrics = async (userId) => {
  const id = new mongoose.Types.ObjectId(String(userId));
  const [agg, dailiesFinished, user] = await Promise.all([
    Result.aggregate([
      { $match: { userId: id } },
      {
        $group: {
          _id: null,
          runs: { $sum: 1 },
          maxElapsed: { $max: '$elapsedTime' },
          bestWpm: { $max: { $cond: ['$ranked', '$wpm', 0] } },
          bestAccuracy: {
            $max: {
              $cond: [{ $and: ['$ranked', { $gte: ['$successes', FLAWLESS_MIN_CORRECT_CHARS] }] }, '$accuracy', 0],
            },
          },
          best60sAccuracy: { $max: { $cond: [{ $and: ['$ranked', { $eq: ['$timeMax', 60] }] }, '$accuracy', 0] } },
          bestConsistency: { $max: { $cond: ['$ranked', '$consistency', 0] } },
          speedrun: {
            $max: {
              $cond: [
                {
                  $and: [
                    '$ranked',
                    { $eq: ['$gameMode', 'words'] },
                    { $gte: ['$totalWords', SPEEDRUN_WORDS] },
                    { $gte: ['$completionPercentage', 100] },
                    { $lt: ['$elapsedTime', SPEEDRUN_SECONDS] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    DailyAttempt.countDocuments({ userId: id, finishedAt: { $ne: null } }),
    User.findById(id).select('stats.raceWins stats.streak').lean(),
  ]);

  const r = agg[0] || {};
  return {
    runs: r.runs || 0,
    bestWpm: r.bestWpm || 0,
    bestAccuracy: r.bestAccuracy || 0,
    best60sAccuracy: r.best60sAccuracy || 0,
    bestConsistency: r.bestConsistency || 0,
    longestRunMinutes: Math.floor((r.maxElapsed || 0) / 60),
    speedrunWords: speedrunProgress(r.speedrun === 1, r.bestWpm || 0),
    longestStreak: user?.stats?.streak?.longest || 0,
    dailiesFinished,
    raceWins: user?.stats?.raceWins || 0,
  };
};

/** Records today's play on the player's streak. */
export const recordPlayDay = async (userId, now = new Date()) => {
  const user = await User.findById(userId).select('stats.streak').lean();
  const next = nextStreak(user?.stats?.streak, dateKey(now));
  await User.updateOne({ _id: userId }, { $set: { 'stats.streak': next } });
};

/**
 * Evaluates every badge and stores new unlocks. Idempotent: unlocks are
 * insert-only upserts on (userId, achievementId), so evaluating the same
 * state twice unlocks nothing new.
 *
 * @returns {{ achievements: Array, newlyUnlocked: string[] }}
 */
export const syncAchievements = async (userId, now = new Date()) => {
  const progress = evaluateAchievements(await computeMetrics(userId));
  const unlocked = progress.filter((p) => p.unlocked);

  let newlyUnlocked = [];
  if (unlocked.length) {
    const res = await UserAchievement.bulkWrite(
      unlocked.map((p) => ({
        updateOne: {
          filter: { userId, achievementId: p.id },
          update: { $setOnInsert: { unlockedAt: now } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    newlyUnlocked = Object.keys(res.upsertedIds || {}).map((i) => unlocked[Number(i)].id);
  }

  const stored = await UserAchievement.find({ userId }).lean();
  const unlockedAt = new Map(stored.map((s) => [s.achievementId, s.unlockedAt]));

  return {
    achievements: ACHIEVEMENTS.map(({ metric, ...a }, i) => ({
      ...a,
      value: progress[i].value,
      // A stored unlock stays unlocked even if criteria later tighten.
      unlocked: unlockedAt.has(a.id),
      unlockedAt: unlockedAt.get(a.id) ?? null,
    })),
    newlyUnlocked,
  };
};
