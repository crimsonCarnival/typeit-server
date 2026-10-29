import {
  claimAttempt,
  dateKey,
  getDailyOverview,
  getOrCreateChallenge,
  releaseAttempt,
} from '../services/daily.service.js';
import { startDailySession } from '../services/game.service.js';
import { startDailyGhostRun } from '../services/replay.service.js';

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

  /**
   * POST /api/daily/ghost  { date?, target?: 'leader'|'pb' }
   * Practice run on a day's text against its winner's ghost or your PB (today's only
   * after finishing your own attempt). Saved, never ranked.
   */
  ghost: async (req, res) => {
    try {
      const date = req.body?.date ?? dateKey(new Date());
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ success: false, error: 'Invalid date' });
      }
      const target = req.body?.target === 'pb' ? 'pb' : 'leader';
      const out = await startDailyGhostRun(req.user._id, date, new Date(), target);
      if (out.error) return res.status(out.status).json({ success: false, error: out.error });
      res.json({ success: true, data: out });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Could not start the ghost race' });
    }
  },
};

export default dailyController;
