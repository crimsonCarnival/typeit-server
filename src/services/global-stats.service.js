import Result from '../models/result.model.js';
import User from '../models/user.model.js';

/** The site-wide numbers change slowly; recount at most this often. */
export const GLOBAL_STATS_TTL_MS = 10 * 60 * 1000;
export const BAND_SIZE = 10;

let cache = null;

/**
 * Speed bands for the distribution chart: how many players have their best
 * verified 60-second run in each 10-WPM band, from 0 up to the fastest band.
 * Players who opted out of leaderboards are left out.
 */
export const toBands = (bests, size = BAND_SIZE) => {
  if (!bests.length) return [];
  const top = Math.floor(Math.max(...bests) / size);
  const bands = Array.from({ length: top + 1 }, (_, i) => ({ from: i * size, to: i * size + size - 1, players: 0 }));
  for (const wpm of bests) bands[Math.floor(wpm / size)].players++;
  return bands;
};

const count = async () => {
  const [[results], [users], bests, optedOut] = await Promise.all([
    Result.aggregate([{ $group: { _id: null, completed: { $sum: 1 }, seconds: { $sum: { $min: ['$elapsedTime', '$timeMax'] } } } }]),
    User.aggregate([{ $group: { _id: null, started: { $sum: { $ifNull: ['$stats.testsStarted', 0] } }, players: { $sum: 1 } } }]),
    Result.aggregate([
      { $match: { ranked: true, timeMax: 60, userId: { $ne: null } } },
      { $group: { _id: '$userId', wpm: { $max: '$wpm' } } },
    ]),
    User.find({ leaderboardOptOut: true }).select('_id').lean(),
  ]);
  const hidden = new Set(optedOut.map((u) => String(u._id)));
  const speeds = bests.filter((b) => !hidden.has(String(b._id))).map((b) => b.wpm);
  const completed = results?.completed ?? 0;
  return {
    players: users?.players ?? 0,
    // Accounts from before starts were counted have at least as many starts as finishes.
    started: Math.max(users?.started ?? 0, completed),
    completed,
    seconds: Math.round(results?.seconds ?? 0),
    distribution: { results: speeds.length, bands: toBands(speeds) },
  };
};

/** Totals across every player, and the 60-second speed distribution. Cached. */
export const getGlobalStats = async (now = Date.now()) => {
  if (!cache || now - cache.at > GLOBAL_STATS_TTL_MS) cache = { at: now, data: await count() };
  return { ...cache.data, updatedAt: new Date(cache.at).toISOString() };
};

export const clearGlobalStatsCache = () => {
  cache = null;
};
