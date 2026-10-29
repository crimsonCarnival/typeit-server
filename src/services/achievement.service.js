import mongoose from 'mongoose';
import Result from '../models/result.model.js';
import User from '../models/user.model.js';
import DailyAttempt from '../models/daily-attempt.model.js';
import UserAchievement from '../models/user-achievement.model.js';
import LessonProgress from '../models/lesson-progress.model.js';
import Race from '../models/race.model.js';
import {
  ACHIEVEMENTS,
  FLAWLESS_MIN_CORRECT_CHARS,
  HISTORY_RACE_LIMIT,
  HISTORY_RUN_LIMIT,
  METRONOME_RUNS,
  SPEEDRUN_SECONDS,
  SPEEDRUN_WORDS,
  WELL_TRAVELED_CONFIGS,
  WELL_TRAVELED_RUNS,
} from '../config/achievements.js';
import { dateKey } from './daily.service.js';
import { notify } from './notification.service.js';
import { awardXp } from './xp.service.js';
import { XP_BY_RARITY } from '../config/levels.js';
import {
  comebackProgress,
  countBreakthroughs,
  countClockFinishes,
  countDistinctOpponents,
  countImprovedKeys,
  countLanguagesPlayed,
  countModesPlayed,
  countModifierRuns,
  countOldRecordsBroken,
  countPerfectStorms,
  countPhotoFinishes,
  countUnderdogWins,
  longestMetronome,
  longestMomentumChain,
  longestPerfectStreak,
  longestWinStreak,
  personalBestEvents,
  wellTraveledProgress,
} from './achievement-history.js';

const RUN_FIELDS =
  'createdAt wpm accuracy successes elapsedTime timeMax gameMode wordCount modifiers language textCategory ' +
  'ranked practiceKind practiceId dailyDate completionPercentage penalty keyPresses keyErrors';

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

/**
 * Metrics that need the order of a player's runs and races (personal bests,
 * sequences, drills). Pure: the same history always gives the same numbers.
 * @param {object[]} runs   oldest first
 * @param {object[]} races  oldest first
 */
export const historyMetrics = (runs, races, userId) => {
  const events = personalBestEvents(runs);
  return {
    breakthroughs: countBreakthroughs(events),
    oldRecordsBroken: countOldRecordsBroken(events),
    clockFinishes: countClockFinishes(events),
    momentumChain: longestMomentumChain(events),
    perfectStorms: countPerfectStorms(runs),
    metronomeRuns: Math.min(longestMetronome(runs), METRONOME_RUNS),
    perfectStreak: longestPerfectStreak(runs),
    numbersRuns: countModifierRuns(runs, ['numbers', 'both']),
    punctuationRuns: countModifierRuns(runs, ['punctuation', 'both']),
    bothModifierRuns: countModifierRuns(runs, ['both']),
    wellTraveled: wellTraveledProgress(runs, WELL_TRAVELED_RUNS, WELL_TRAVELED_CONFIGS),
    modesPlayed: countModesPlayed(runs),
    languagesPlayed: countLanguagesPlayed(runs),
    comebackRuns: comebackProgress(runs),
    improvedKeys: countImprovedKeys(runs),
    winStreak: longestWinStreak(races, userId),
    photoFinishes: countPhotoFinishes(races, userId),
    underdogWins: countUnderdogWins(races, userId),
    distinctOpponents: countDistinctOpponents(races, userId),
  };
};

/** The player's latest runs and races, oldest first, without the heavy fields. */
const loadHistory = async (id) => {
  const [runs, races] = await Promise.all([
    Result.find({ userId: id }).sort({ createdAt: -1 }).limit(HISTORY_RUN_LIMIT).select(RUN_FIELDS).lean(),
    Race.find({ 'players.userId': id }).sort({ finishedAt: -1 }).limit(HISTORY_RACE_LIMIT).select('players mode winnerId startAt finishedAt').lean(),
  ]);
  return { runs: runs.reverse(), races: races.reverse() };
};

/** Reads every metric the badges need, in a few queries. */
export const computeMetrics = async (userId) => {
  const id = new mongoose.Types.ObjectId(String(userId));
  const [agg, dailiesFinished, user, lessons, history] = await Promise.all([
    Result.aggregate([
      { $match: { userId: id } },
      {
        $group: {
          _id: null,
          runs: { $sum: 1 },
          maxElapsed: { $max: '$elapsedTime' },
          activeSeconds: { $sum: { $min: ['$elapsedTime', '$timeMax'] } },
          bestWpm: { $max: { $cond: ['$ranked', '$wpm', 0] } },
          flawlessRuns: {
            $sum: {
              $cond: [{ $and: ['$ranked', { $gte: ['$successes', FLAWLESS_MIN_CORRECT_CHARS] }, { $gte: ['$accuracy', 100] }] }, 1, 0],
            },
          },
          bestHardcoreWpm: { $max: { $cond: [{ $and: ['$ranked', { $eq: ['$rules.difficulty', 'hardcore'] }] }, '$wpm', 0] } },
          drillRuns: { $sum: { $cond: [{ $eq: ['$practiceKind', 'drill'] }, 1, 0] } },
          listRuns: { $sum: { $cond: [{ $eq: ['$practiceKind', 'list'] }, 1, 0] } },
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
    LessonProgress.find({ userId: id, completedAt: { $ne: null } }).select('lessonId').lean(),
    loadHistory(id),
  ]);

  const r = agg[0] || {};
  return {
    ...historyMetrics(history.runs, history.races, String(userId)),
    // Whole lifetime, not just the history window; each run counts at most its own time limit.
    activeHours: Math.round(((r.activeSeconds || 0) / 3600) * 10) / 10,
    runs: r.runs || 0,
    bestWpm: r.bestWpm || 0,
    flawlessRuns: r.flawlessRuns || 0,
    bestHardcoreWpm: r.bestHardcoreWpm || 0,
    drillRuns: r.drillRuns || 0,
    listRuns: r.listRuns || 0,
    lessonsPassed: lessons.filter((l) => l.lessonId !== 'common-words').length,
    commonWordsPassed: lessons.some((l) => l.lessonId === 'common-words') ? 1 : 0,
    best60sAccuracy: r.best60sAccuracy || 0,
    bestConsistency: r.bestConsistency || 0,
    longestRunMinutes: Math.floor((r.maxElapsed || 0) / 60),
    speedrunWords: speedrunProgress(r.speedrun === 1, r.bestWpm || 0),
    longestStreak: user?.stats?.streak?.longest || 0,
    dailiesFinished,
    raceWins: user?.stats?.raceWins || 0,
  };
};

/**
 * A hidden badge before it is earned: no name, id, icon, target or progress
 * that would give away what it asks for, only a vague hint. The id is a
 * position-based placeholder, so it can't leak through the page either.
 */
export const maskHidden = (card, hint, index) => ({
  id: `hidden-${index}`,
  hidden: true,
  name: 'Hidden achievement',
  description: hint || 'Keep playing to find this one.',
  category: card.category,
  rarity: card.rarity,
  icon: 'lock',
  target: 1,
  unit: '',
  value: 0,
  unlocked: false,
  unlockedAt: null,
});

/**
 * Notifies the player of badges they just earned. A pile of them at once (the
 * first evaluation of an old account) is one notice, not a flood.
 */
const announceUnlocks = async (userId, ids) => {
  if (!ids.length) return;
  const named = ids.map((id) => ACHIEVEMENTS.find((a) => a.id === id)).filter(Boolean);
  // Experience for each badge, by rarity. Unlocks are insert-only, so each is rewarded once.
  await awardXp(userId, named.reduce((sum, a) => sum + (XP_BY_RARITY[a.rarity] ?? 0), 0));
  if (named.length > 3) {
    await notify(userId, {
      type: 'achievement',
      title: `You unlocked ${named.length} achievements`,
      body: named.slice(0, 3).map((a) => a.name).join(', ') + ' and more.',
      link: '/achievements',
      dedupeKey: `achievements:${ids.slice().sort().join(',')}`,
    });
    return;
  }
  for (const a of named) {
    await notify(userId, { type: 'achievement', title: `Achievement unlocked: ${a.name}`, body: a.description, link: '/achievements', dedupeKey: `achievement:${a.id}` });
  }
};

/** Records today's play on the player's streak. */
export const recordPlayDay = async (userId, now = new Date()) => {
  const user = await User.findById(userId).select('stats.streak streakHourOffset').lean();
  // The player's chosen offset moves where their day starts (UTC by default).
  const shifted = new Date(now.getTime() + (user?.streakHourOffset || 0) * 60 * 60 * 1000);
  const next = nextStreak(user?.stats?.streak, dateKey(shifted));
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

  await announceUnlocks(userId, newlyUnlocked);

  const stored = await UserAchievement.find({ userId }).lean();
  const unlockedAt = new Map(stored.map((s) => [s.achievementId, s.unlockedAt]));

  return {
    achievements: ACHIEVEMENTS.map(({ metric, hint, ...a }, i) => {
      const card = {
        ...a,
        value: progress[i].value,
        // A stored unlock stays unlocked even if criteria later tighten.
        unlocked: unlockedAt.has(a.id),
        unlockedAt: unlockedAt.get(a.id) ?? null,
      };
      return a.hidden && !card.unlocked ? maskHidden(card, hint, i) : card;
    }),
    newlyUnlocked,
  };
};
