import { getRankings } from '../services/ranking.service.js';
import {
  DEFAULT_RANKINGS_LIMIT,
  MAX_RANKINGS_LIMIT,
  RANKING_MODES,
  RANKING_MODIFIERS,
  RANKING_PERIODS,
  RANKING_REGIONS,
  RANKING_TIME_LIMITS,
} from '../config/rankings.js';

/**
 * Parses and whitelists query params. Every value must come from a fixed
 * list, so nothing user-supplied reaches the aggregation unchecked.
 */
const parseQuery = (query) => {
  const period = query.period ?? 'all';
  const mode = query.mode ?? 'words';
  // Phrases runs have no time limit, so their board ignores it.
  const time = mode === 'phrases' ? null : Number(query.time ?? 60);
  const modifiers = query.modifiers ?? 'none';
  const region = query.region ?? 'all';
  const limit = Number(query.limit ?? DEFAULT_RANKINGS_LIMIT);

  if (!RANKING_PERIODS.includes(period)) return { error: 'Invalid period' };
  if (!RANKING_MODES.includes(mode)) return { error: 'Invalid mode' };
  if (time !== null && !RANKING_TIME_LIMITS.includes(time)) return { error: 'Invalid time limit' };
  if (!RANKING_MODIFIERS.includes(modifiers)) return { error: 'Invalid modifiers' };
  if (!RANKING_REGIONS.includes(region)) return { error: 'Invalid region' };
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RANKINGS_LIMIT) return { error: 'Invalid limit' };

  return { params: { period, mode, time, modifiers, region, limit } };
};

const rankingsController = {
  /**
   * GET /api/rankings?period&mode&time&modifiers&region&limit
   * Public; signed-in players also get their own row as `me`.
   */
  list: async (req, res) => {
    const { params, error } = parseQuery(req.query);
    if (error) return res.status(400).json({ success: false, error });

    try {
      const data = await getRankings({ ...params, userId: req.user?._id ?? null });
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Could not load rankings' });
    }
  },
};

export default rankingsController;
