import Result from '../models/result.model.js';
import { MIN_RANKED_INTEGRITY_VERSION } from '../config/integrity.js';
import { RANKINGS_CACHE_TTL_MS, REGION_BY_TZ_AREA } from '../config/rankings.js';

/** Maps an IANA timezone to a ranking region, or null when it has none. */
export const regionFromTimezone = (timezone) => {
  if (typeof timezone !== 'string') return null;
  return REGION_BY_TZ_AREA[timezone.split('/')[0]] ?? null;
};

/**
 * Orders players and assigns ranks. Higher WPM wins; equal WPM is broken by
 * higher accuracy, then by whoever set the score first. Players equal on all
 * three share a rank and the next rank is skipped ("1, 2, 2, 4").
 *
 * @param {Array<{wpm:number, accuracy:number, achievedAt:Date}>} entries
 * @returns {Array<object>} new array, sorted, each entry with a `rank`
 */
export const rankEntries = (entries) => {
  const sorted = [...entries].sort(compareEntries);
  let rank = 0;
  return sorted.map((entry, i) => {
    if (i === 0 || compareEntries(sorted[i - 1], entry) !== 0) rank = i + 1;
    return { ...entry, rank };
  });
};

const compareEntries = (a, b) =>
  b.wpm - a.wpm ||
  b.accuracy - a.accuracy ||
  new Date(a.achievedAt).getTime() - new Date(b.achievedAt).getTime();

export const startOfUtcMonth = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// Board cache keyed by filter combination (excluding region, which is applied
// after). At most periods x modes x time limits x modifiers entries.
const boardCache = new Map();

/** Clears cached boards. Exposed for tests and admin tooling. */
export const clearRankingsCache = () => boardCache.clear();

/**
 * Loads every player's best ranked run for one board: one entry per user.
 */
const loadBoard = async ({ period, mode, time, modifiers }, now) => {
  const match = {
    ranked: true,
    integrityVersion: { $gte: MIN_RANKED_INTEGRITY_VERSION[mode] ?? 3 },
    userId: { $ne: null },
    gameMode: mode,
    timeMax: time,
    modifiers,
  };
  if (period === 'month') match.createdAt = { $gte: startOfUtcMonth(now) };

  const rows = await Result.aggregate([
    { $match: match },
    { $sort: { wpm: -1, accuracy: -1, createdAt: 1 } },
    {
      $group: {
        _id: '$userId',
        resultId: { $first: '$_id' },
        wpm: { $first: '$wpm' },
        accuracy: { $first: '$accuracy' },
        achievedAt: { $first: '$createdAt' },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
        pipeline: [
          { $match: { status: 'active' } },
          { $project: { username: 1, displayName: 1, avatar: 1, timezone: 1, 'stats.raceWins': 1 } },
        ],
      },
    },
    { $unwind: '$user' },
  ]);

  return rows.map((row) => ({
    userId: row._id.toString(),
    username: row.user.username,
    displayName: row.user.displayName || row.user.username,
    avatar: row.user.avatar || '',
    region: regionFromTimezone(row.user.timezone),
    raceWins: row.user.stats?.raceWins || 0,
    wpm: row.wpm,
    accuracy: row.accuracy,
    // The run behind the entry, for its replay.
    resultId: row.resultId ? row.resultId.toString() : null,
    achievedAt: row.achievedAt,
  }));
};

const toPublic = ({ region, achievedAt, ...entry }) => entry;

/**
 * Returns one page of a board plus the requesting player's own row.
 * Assumes params were validated by the controller.
 */
export const getRankings = async ({ period, mode, time, modifiers, region, limit, userId = null }, now = new Date()) => {
  const key = `${period}|${mode}|${time}|${modifiers}`;
  let cached = boardCache.get(key);
  if (!cached || now.getTime() - cached.builtAt.getTime() > RANKINGS_CACHE_TTL_MS) {
    cached = { builtAt: now, entries: await loadBoard({ period, mode, time, modifiers }, now) };
    boardCache.set(key, cached);
  }

  const inRegion = region === 'all' ? cached.entries : cached.entries.filter((e) => e.region === region);
  const ranked = rankEntries(inRegion);
  const me = userId ? ranked.find((e) => e.userId === String(userId)) : null;

  return {
    entries: ranked.slice(0, limit).map(toPublic),
    me: me ? toPublic(me) : null,
    totalPlayers: ranked.length,
    updatedAt: cached.builtAt.toISOString(),
  };
};
