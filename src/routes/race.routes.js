import express from 'express';
import User from '../models/user.model.js';
import { auth } from '../middleware/auth.middleware.js';
import { isOnline } from '../services/race/race-manager.js';
import { publicHandle, publicName } from '../utils/public-identity.js';
import { getMutualIds } from '../services/follow.service.js';
import { getRaceHistory, getRaceMistakes } from '../services/race/race-mistakes.js';

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
        username: publicHandle(u),
        displayName: publicName(u),
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
      username: publicHandle(u),
      displayName: publicName(u),
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

/**
 * GET /api/race/history
 * The caller's latest finished races.
 */
router.get('/history', auth, async (req, res) => {
  try {
    res.json({ success: true, data: { races: await getRaceHistory(req.user._id) } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Could not load your races' });
  }
});

/**
 * GET /api/race/:ref/mistakes   (ref: race id, or invite code for its latest race)
 * Every racer's mistakes in one finished race. Visible to the racers and the
 * room's spectators only.
 */
router.get('/:ref/mistakes', auth, async (req, res) => {
  try {
    const out = await getRaceMistakes(req.params.ref, req.user._id);
    if (out.error) return res.status(out.status).json({ success: false, error: out.error });
    res.json({ success: true, data: out });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Could not load the comparison' });
  }
});

export default router;
