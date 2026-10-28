import express from 'express';
import User from '../models/user.model.js';
import { auth } from '../middleware/auth.middleware.js';
import { isOnline } from '../services/race/race-manager.js';
import { getMutualIds } from '../services/follow.service.js';

const router = express.Router();

/**
 * GET /api/race/friends
 * Mutual follows (who you can invite) with live online status.
 */
router.get('/friends', auth, async (req, res) => {
  try {
    const mutual = await getMutualIds(req.user._id);
    const users = await User.find({ _id: { $in: mutual }, status: 'active' })
      .select('username displayName avatar')
      .lean();
    const friends = users
      .map((u) => ({
        userId: u._id.toString(),
        username: u.username,
        displayName: u.displayName || u.username,
        avatar: u.avatar || '',
        online: isOnline(u._id),
      }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName));
    res.json({ success: true, data: { friends } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Could not load friends' });
  }
});

/**
 * GET /api/race/leaderboard
 * Top quick-match ratings (players with at least one rated race).
 */
router.get('/leaderboard', async (req, res) => {
  try {
    const users = await User.find({ status: 'active', 'stats.racesRated': { $gt: 0 } })
      .sort({ 'stats.raceRating': -1, 'stats.racesRated': -1 })
      .limit(50)
      .select('username displayName avatar stats.raceRating stats.racesRated stats.raceWins')
      .lean();
    const entries = users.map((u, i) => ({
      rank: i + 1,
      userId: u._id.toString(),
      username: u.username,
      displayName: u.displayName || u.username,
      avatar: u.avatar || '',
      rating: u.stats.raceRating,
      races: u.stats.racesRated,
      wins: u.stats.raceWins || 0,
    }));
    res.json({ success: true, data: { entries } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Could not load the race leaderboard' });
  }
});

export default router;
