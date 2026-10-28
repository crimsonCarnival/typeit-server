import { syncAchievements } from '../services/achievement.service.js';

const achievementsController = {
  /**
   * GET /api/achievements
   * Every badge with the caller's progress. Also stores any unlock the player
   * already qualifies for (e.g. earned before badges existed).
   */
  list: async (req, res) => {
    try {
      const { achievements } = await syncAchievements(req.user._id);
      res.json({ success: true, data: { achievements } });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Could not load achievements' });
    }
  },
};

export default achievementsController;
