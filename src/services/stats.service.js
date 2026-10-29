import mongoose from 'mongoose';
import Result from '../models/result.model.js';
import User from '../models/user.model.js';
import { BY_DESIGN_FLAGS } from './test-outcomes.service.js';

/** Time limits (seconds) and word counts that get a personal-best slot. */
export const PB_TIME_LIMITS = Object.freeze([15, 30, 60, 90, 120]);
export const PB_WORD_COUNTS = Object.freeze([10, 25, 50, 75, 100]);

/** How many of a player's latest results the dashboard loads. */
export const RESULT_ROWS_LIMIT = 3000;

/** Correct characters per word, the usual typing-test convention. */
const CHARS_PER_WORD = 5;

/**
 * Mongo expression: the integrity checks flagged this result as wrong (not just
 * "ran on casual text"). Results from before the checks existed are never failed.
 */
const FAILED = {
  $and: [
    { $gte: ['$integrityVersion', 1] },
    { $gt: [{ $size: { $setDifference: [{ $ifNull: ['$integrityFlags', []] }, BY_DESIGN_FLAGS] } }, 0] },
  ],
};

/** Seconds a result spent typing: its elapsed time, never beyond its own limit. */
const ACTIVE_SECONDS = { $min: ['$elapsedTime', '$timeMax'] };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The span of the activity graph, in UTC days: a calendar year when `year` is
 * given, otherwise the last twelve months ending today (so the graph is
 * always a full year wide).
 */
export const activityWindow = (now = new Date(), year = null) => {
  if (Number.isInteger(year) && year >= 2000 && year <= now.getUTCFullYear()) {
    return { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year + 1, 0, 1)), year };
  }
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { from: new Date(to.getTime() - 365 * DAY_MS), to, year: null };
};

/** One result as the dashboard and history table need it (short keys: there can be thousands). */
export const toRow = (r) => ({
  id: String(r._id),
  t: new Date(r.createdAt).getTime(),
  wpm: r.wpm ?? 0,
  raw: r.rawWpm ?? r.wpm ?? 0,
  acc: r.accuracy ?? 0,
  cons: r.consistency ?? 0,
  secs: Math.max(0, Math.min(r.elapsedTime ?? 0, r.timeMax ?? r.elapsedTime ?? 0)),
  mode: r.gameMode,
  timeMax: r.timeMax ?? 0,
  words: r.wordCount ?? 0,
  mods: r.modifiers ?? 'none',
  lang: r.language ?? null,
  verified: !!r.ranked,
  flagged: !!r.flagged,
  practice: r.practiceKind ?? null,
  daily: !!r.dailyDate,
  correct: r.successes ?? 0,
  incorrect: r.mistakes ?? 0,
  backspaces: r.backspaces ?? 0,
  replay: !!r.hasLog,
});

/** The player's latest results (oldest first) for the stats dashboard, without the heavy fields. */
export const getResultRows = async (userId, limit = RESULT_ROWS_LIMIT) => {
  const rows = await Result.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(String(userId)) } },
    { $sort: { createdAt: -1 } },
    { $limit: Math.min(limit, RESULT_ROWS_LIMIT) },
    {
      $project: {
        createdAt: 1, wpm: 1, rawWpm: 1, accuracy: 1, consistency: 1, elapsedTime: 1, timeMax: 1, gameMode: 1,
        wordCount: 1, modifiers: 1, language: 1, ranked: 1, practiceKind: 1, dailyDate: 1, successes: 1, mistakes: 1, backspaces: 1,
        flagged: FAILED,
        hasLog: { $gt: [{ $size: { $ifNull: ['$keystrokes', []] } }, 0] },
      },
    },
  ]);
  return rows.reverse().map(toRow);
};

/** Fills a personal-best slot per preset, null where the player has no result yet. */
const slots = (presets, best) => presets.map((p) => (best.has(p) ? { limit: p, ...best.get(p) } : null));

/**
 * What a profile shows: totals, personal bests per time limit and word count,
 * and a graph of tests per UTC day. Public: it only counts what the stats
 * already expose. Personal bests skip practice and daily runs and anything
 * the integrity checks flagged.
 *
 * @param {string} userId
 * @param {{ year?: number|null, now?: Date }} [options]
 */
export const getProfileOverview = async (userId, { year = null, now = new Date() } = {}) => {
  const id = new mongoose.Types.ObjectId(String(userId));
  const { from, to, year: shownYear } = activityWindow(now, year);

  const reset = await User.findById(id).select('pbResetAt').lean();
  // After "reset personal bests", only later results count as bests.
  const sinceReset = reset?.pbResetAt ? { createdAt: { $gt: reset.pbResetAt } } : {};

  const [[facets], user] = await Promise.all([
    Result.aggregate([
      { $match: { userId: id } },
      {
        $addFields: {
          failed: FAILED,
          active: ACTIVE_SECONDS,
          day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
        },
      },
      {
        $facet: {
          totals: [{ $group: { _id: null, completed: { $sum: 1 }, seconds: { $sum: '$active' }, correct: { $sum: '$successes' }, first: { $min: '$createdAt' } } }],
          activity: [{ $match: { createdAt: { $gte: from, $lt: to } } }, { $group: { _id: '$day', count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
          pbTime: [
            { $match: { ...sinceReset, practiceKind: null, dailyDate: null, failed: false, timeMax: { $in: [...PB_TIME_LIMITS] }, gameMode: { $in: ['words', 'code'] } } },
            { $sort: { wpm: -1, accuracy: -1 } },
            { $group: { _id: '$timeMax', wpm: { $first: '$wpm' }, accuracy: { $first: '$accuracy' } } },
          ],
          pbWords: [
            { $match: { ...sinceReset, practiceKind: null, dailyDate: null, failed: false, gameMode: 'words', wordCount: { $in: [...PB_WORD_COUNTS] }, completionPercentage: { $gte: 100 } } },
            { $sort: { wpm: -1, accuracy: -1 } },
            { $group: { _id: '$wordCount', wpm: { $first: '$wpm' }, accuracy: { $first: '$accuracy' } } },
          ],
        },
      },
    ]),
    User.findById(id).select('stats.testsStarted').lean(),
  ]);

  const t = facets?.totals?.[0] ?? { completed: 0, seconds: 0, correct: 0, first: null };
  const started = Math.max(user?.stats?.testsStarted || 0, t.completed);
  const toMap = (rows) => new Map(rows.map((r) => [r._id, { wpm: r.wpm, accuracy: r.accuracy }]));
  const firstYear = t.first ? new Date(t.first).getUTCFullYear() : now.getUTCFullYear();
  const years = Array.from({ length: now.getUTCFullYear() - firstYear + 1 }, (_, i) => now.getUTCFullYear() - i);
  const days = (facets?.activity ?? []).map((d) => ({ date: d._id, count: d.count }));

  return {
    totals: {
      started,
      completed: t.completed,
      completionRate: started ? Math.round((t.completed / started) * 100) : null,
      // Restarts: tests started and dropped, per test that was finished.
      restartsPerTest: t.completed ? Math.round(((started - t.completed) / t.completed) * 10) / 10 : null,
      timeTyping: Math.round(t.seconds),
      estimatedWords: Math.floor(t.correct / CHARS_PER_WORD),
    },
    personalBests: {
      time: slots(PB_TIME_LIMITS, toMap(facets?.pbTime ?? [])),
      words: slots(PB_WORD_COUNTS, toMap(facets?.pbWords ?? [])),
    },
    activity: { from: from.toISOString(), to: to.toISOString(), year: shownYear, years, total: days.reduce((n, d) => n + d.count, 0), days },
  };
};
