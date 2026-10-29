import crypto from 'crypto';
import DailyChallenge from '../models/daily-challenge.model.js';
import DailyAttempt from '../models/daily-attempt.model.js';
import User from '../models/user.model.js';
import { generateWordContent } from '../data/words.js';
import { seededRandom } from '../utils/seeded-random.js';
import { JWT_SECRET } from '../config/env.js';
import { DAILY_HISTORY_DAYS, DAILY_LEADERS_LIMIT, DAILY_SETTINGS_POOL } from '../config/daily.js';
import { rankEntries } from './ranking.service.js';
import { publicHandle, publicName, staffRole } from '../utils/public-identity.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC calendar day as 'YYYY-MM-DD'. */
export const dateKey = (now) => now.toISOString().slice(0, 10);

/** Next UTC midnight after `now`. */
export const nextResetAt = (now) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

/** The `count` UTC days before `date`, most recent first. */
export const previousDates = (date, count) =>
  Array.from({ length: count }, (_, i) => dateKey(new Date(Date.parse(date) - (i + 1) * DAY_MS)));

/**
 * Seed for a day's challenge. Keyed with a server secret so nobody can
 * compute future days' texts from the (public) source and practise them.
 * Derived from JWT_SECRET with a distinct label rather than adding another
 * required production secret.
 */
export const dailySeed = (date, secret = JWT_SECRET) =>
  crypto.createHmac('sha256', secret).update(`typeit-daily:${date}`).digest('hex');

/** Builds a day's challenge. Pure and deterministic for a given (date, secret). */
export const buildChallenge = (date, secret = JWT_SECRET) => {
  const seed = dailySeed(date, secret);
  const settings = DAILY_SETTINGS_POOL[Math.floor(seededRandom(`${seed}:settings`)() * DAILY_SETTINGS_POOL.length)];
  const raw = generateWordContent(settings.wordCount, {
    punctuation: settings.punctuationEnabled,
    numbers: settings.numbersEnabled,
    seed,
  });
  const text = raw.replace(/\s+/g, ' ').trim();
  return { date, gameMode: 'words', ...settings, text, totalWords: text.split(' ').length };
};

/**
 * Returns the stored challenge for `date`, creating it on first request.
 * The upsert makes concurrent first requests converge on one document.
 */
export const getOrCreateChallenge = async (date) => {
  const existing = await DailyChallenge.findOne({ date }).lean();
  if (existing) return existing;
  return await DailyChallenge.findOneAndUpdate(
    { date },
    { $setOnInsert: buildChallenge(date) },
    { upsert: true, new: true, lean: true }
  );
};

/**
 * Claims the player's one attempt for `date`. Returns false when they already
 * have one; the unique (userId, date) index decides races.
 */
export const claimAttempt = async (userId, date, now) => {
  try {
    await DailyAttempt.create({ userId, date, startedAt: now });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
};

/** Undoes a claim when the run could not actually be started. */
export const releaseAttempt = (userId, date) => DailyAttempt.deleteOne({ userId, date, finishedAt: null });

/** Stores the outcome of a daily run on the player's attempt (first finish only). */
export const recordDailyFinish = (userId, date, { resultId, wpm, accuracy, ranked }, now = new Date()) =>
  DailyAttempt.updateOne(
    { userId, date, finishedAt: null },
    { $set: { finishedAt: now, resultId, wpm, accuracy, ranked } }
  );

const publicUser = (u) => ({
  userId: u._id.toString(),
  username: publicHandle(u),
  displayName: publicName(u),
  avatar: u.avatar || '',
  role: staffRole(u),
});

/** Today's challenge summary (never the text), leaders, past winners and the caller's status. */
export const getDailyOverview = async (userId, now = new Date()) => {
  const date = dateKey(now);
  const challenge = await getOrCreateChallenge(date);
  const pastDates = previousDates(date, DAILY_HISTORY_DAYS);

  const [rankedToday, playersToday, mine, pastBest] = await Promise.all([
    DailyAttempt.find({ date, ranked: true })
      .populate('userId', 'username displayName avatar role status leaderboardOptOut')
      .lean(),
    DailyAttempt.countDocuments({ date, finishedAt: { $ne: null } }),
    userId ? DailyAttempt.find({ userId, date: { $in: [date, ...pastDates] } }).lean() : [],
    DailyAttempt.aggregate([
      { $match: { date: { $in: pastDates }, ranked: true } },
      { $sort: { wpm: -1, accuracy: -1, finishedAt: 1 } },
      { $group: { _id: '$date', userId: { $first: '$userId' }, wpm: { $first: '$wpm' } } },
    ]),
  ]);

  const leaders = rankEntries(
    rankedToday
      .filter((a) => a.userId && a.userId.status === 'active' && !a.userId.leaderboardOptOut)
      .map((a) => ({ ...publicUser(a.userId), wpm: a.wpm, accuracy: a.accuracy, resultId: a.resultId ? a.resultId.toString() : null, achievedAt: a.finishedAt }))
  ).map(({ achievedAt, ...entry }) => entry);

  const winners = await User.find({ _id: { $in: pastBest.map((b) => b.userId) }, status: 'active', leaderboardOptOut: { $ne: true } })
    .select('username displayName avatar role')
    .lean();
  const winnerById = new Map(winners.map((u) => [u._id.toString(), publicUser(u)]));
  const myByDate = new Map(mine.map((a) => [a.date, a]));

  const today = myByDate.get(date);
  let me = null;
  if (userId) {
    const status = !today ? 'not-played' : today.finishedAt ? 'finished' : 'in-progress';
    const myRank = leaders.find((l) => l.userId === String(userId))?.rank ?? null;
    me = { status, wpm: today?.wpm ?? null, accuracy: today?.accuracy ?? null, ranked: !!today?.ranked, rank: myRank };
  }

  return {
    date,
    resetsAt: nextResetAt(now).toISOString(),
    settings: {
      gameMode: challenge.gameMode,
      wordCount: challenge.wordCount,
      timeMax: challenge.timeMax,
      punctuationEnabled: challenge.punctuationEnabled,
      numbersEnabled: challenge.numbersEnabled,
    },
    playersToday,
    leaders: leaders.slice(0, DAILY_LEADERS_LIMIT),
    me,
    pastDays: pastDates.map((d) => {
      const best = pastBest.find((b) => b._id === d);
      const winner = best ? winnerById.get(best.userId.toString()) : null;
      return {
        date: d,
        winner: winner ? { ...winner, wpm: best.wpm } : null,
        myWpm: myByDate.get(d)?.wpm ?? null,
      };
    }),
  };
};

const DAY_DETAIL_LIMIT = 50;

/**
 * One past day's details: its settings, how many played, the ranked
 * leaderboard (top DAY_DETAIL_LIMIT) and the caller's own result. Never the
 * text. Today stays on the overview, and future or unplayed days have nothing.
 *
 * @returns {Promise<{ error: string, status: number } | object>}
 */
export const getDailyDay = async (userId, date, now = new Date()) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { error: 'Invalid date', status: 400 };
  if (date >= dateKey(now)) return { error: 'Only past days have a summary', status: 400 };

  const challenge = await DailyChallenge.findOne({ date }).lean();
  if (!challenge) return { error: 'No challenge on that day', status: 404 };

  const [ranked, started, finished, mine] = await Promise.all([
    DailyAttempt.find({ date, ranked: true }).populate('userId', 'username displayName avatar role status leaderboardOptOut').lean(),
    DailyAttempt.countDocuments({ date }),
    DailyAttempt.countDocuments({ date, finishedAt: { $ne: null } }),
    userId ? DailyAttempt.findOne({ userId, date }).lean() : null,
  ]);

  const entries = rankEntries(
    ranked
      .filter((a) => a.userId && a.userId.status === 'active' && !a.userId.leaderboardOptOut)
      .map((a) => ({ ...publicUser(a.userId), wpm: a.wpm, accuracy: a.accuracy, resultId: a.resultId ? a.resultId.toString() : null, achievedAt: a.finishedAt }))
  ).map(({ achievedAt, ...entry }) => entry);

  const mineRow = userId ? entries.find((e) => e.userId === String(userId)) : null;
  return {
    date,
    settings: {
      gameMode: challenge.gameMode,
      wordCount: challenge.wordCount,
      timeMax: challenge.timeMax,
      punctuationEnabled: challenge.punctuationEnabled,
      numbersEnabled: challenge.numbersEnabled,
    },
    started,
    finished,
    rankedCount: entries.length,
    averageWpm: entries.length ? Math.round(entries.reduce((sum, e) => sum + e.wpm, 0) / entries.length) : null,
    winner: entries[0] ?? null,
    entries: entries.slice(0, DAY_DETAIL_LIMIT),
    me: userId
      ? {
          status: !mine ? 'not-played' : mine.finishedAt ? 'finished' : 'in-progress',
          wpm: mine?.wpm ?? null,
          accuracy: mine?.accuracy ?? null,
          ranked: !!mine?.ranked,
          rank: mineRow?.rank ?? null,
        }
      : null,
  };
};
