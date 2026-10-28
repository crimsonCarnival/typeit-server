import {
  claimAttempt,
  dateKey,
  getDailyOverview,
  getOrCreateChallenge,
  releaseAttempt,
} from '../services/daily.service.js';
import { startDailySession } from '../services/game.service.js';

const dailyController = {
  /**
   * GET /api/daily
   * Public. Settings, leaders and past winners; the text itself is only
   * revealed by POST /daily/start, so it can't be practised beforehand.
   */
  overview: async (req, res) => {
    try {
      const data = await getDailyOverview(req.user?._id ?? null);
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Could not load the daily challenge' });
    }
  },

  /**
   * POST /api/daily/start
   * Uses up the player's one attempt for today and switches their session to
   * the daily text. Starting counts as the attempt, so abandoning a bad run
   * and retrying is not possible.
   */
  start: async (req, res) => {
    const userId = req.user._id;
    const now = new Date();
    const date = dateKey(now);

    try {
      const challenge = await getOrCreateChallenge(date);
      const claimed = await claimAttempt(userId, date, now);
      if (!claimed) {
        return res.status(409).json({ success: false, error: "You've already played today's challenge." });
      }

      try {
        const state = await startDailySession(userId, challenge);
        return res.json({ success: true, data: state });
      } catch (err) {
        // Don't burn the attempt on a server-side failure.
        await releaseAttempt(userId, date);
        throw err;
      }
    } catch (err) {
      res.status(500).json({ success: false, error: 'Could not start the daily challenge' });
    }
  },
};

export default dailyController;
