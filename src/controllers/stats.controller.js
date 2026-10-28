import Result from '../models/result.model.js';

/**
 * Stats Controller — authenticated user statistics endpoints.
 */
const statsController = {
  /**
   * Returns the authenticated user's completed sessions as a summary list,
   * ordered chronologically (oldest first). Excludes the full PerformancePoint[]
   * array — use the full Result document if per-second detail is needed.
   *
   * GET /api/stats/history
   * Query params: limit (default 50), gameMode, timeMax
   */
  getHistory: async (req, res) => {
    try {
      const userId = req.user?._id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const filter = { userId };

      if (req.query.gameMode) filter.gameMode = req.query.gameMode;
      if (req.query.timeMax) filter.timeMax = parseInt(req.query.timeMax);

      const results = await Result.find(filter)
        .sort({ createdAt: 1 })   // ascending = chronological order for the chart
        .limit(limit)
        .select(
          'score wpm cpm rawWpm accuracy consistency gameMode wordCount timeMax ' +
          'completionPercentage migrated createdAt'
        )
        .lean();

      const sessions = results.map((r) => ({
        sessionId:            r._id.toString(),
        endTime:              new Date(r.createdAt).getTime(),
        wpm:                  r.wpm ?? 0,
        cpm:                  r.cpm ?? 0,
        rawWpm:               r.rawWpm,          // may be undefined — client handles it
        accuracy:             r.accuracy ?? 0,
        score:                r.score ?? 0,
        consistency:          r.consistency,     // may be undefined
        gameMode:             r.gameMode,
        wordCount:            r.wordCount ?? 0,
        timeMax:              r.timeMax ?? 0,
        completionPercentage: r.completionPercentage ?? 0,
        migrated:             r.migrated === true,
      }));

      return res.json({ success: true, data: { sessions } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },
};

export default statsController;
