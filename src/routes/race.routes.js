import express from 'express';
import User from '../models/user.model.js';
import { auth } from '../middleware/auth.middleware.js';
import { isOnline } from '../services/race/race-manager.js';
import { publicHandle, publicName } from '../utils/public-identity.js';

const router = express.Router();

/**
 * GET /api/race/friends
 * Mutual follows (who you can invite) with live online status.
 */
router.get('/friends', auth, async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('following followers').lean();
    const followers = new Set((me?.followers ?? []).map(String));
    const mutual = (me?.following ?? []).filter((id) => followers.has(String(id)));
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

export default router;
