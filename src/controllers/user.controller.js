import {
  getProfile,
  updateProfile,
  getLeaderboard,
  deleteAccount,
  searchUsers,
  getPublicProfile,
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
} from '../services/user.service.js';
import { asString, clampInt, errorMessage } from '../utils/http.js';
import { checkAvatar, checkOptionalString, checkTimezone, checkUsername, parseSettingsPatch } from '../utils/validate.js';
import User from '../models/user.model.js';
import { getTestOutcomes } from '../services/test-outcomes.service.js';

const userController = {
  /**
   * The signed-in player's started / abandoned / finished test counts
   * GET /api/users/profile/outcomes
   */
  getOutcomes: async (req, res) => {
    try {
      res.json({ success: true, data: await getTestOutcomes(req.userId) });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  },

  /**
   * Get current user profile
   * GET /api/users/profile
   */
  getProfile: async (req, res) => {
    try {
      const user = await getProfile(req.userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error),
      });
    }
  },

  /**
   * Update current user profile
   * PATCH /api/users/profile
   */
  /**
   * GET /api/users/settings
   * The caller's saved display and typing preferences.
   */
  getSettings: async (req, res) => {
    try {
      const user = await User.findById(req.userId).select('settings').lean();
      if (!user) return res.status(404).json({ success: false, error: 'User not found' });
      res.json({ success: true, data: user.settings || {} });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  },

  /**
   * PATCH /api/users/settings
   * Merges known settings into the caller's preferences.
   */
  updateSettings: async (req, res) => {
    const parsed = parseSettingsPatch(req.body);
    if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
    try {
      const sets = Object.fromEntries(Object.entries(parsed.settings).map(([k, v]) => [`settings.${k}`, v]));
      const user = await User.findByIdAndUpdate(req.userId, { $set: sets }, { new: true }).select('settings').lean();
      if (!user) return res.status(404).json({ success: false, error: 'User not found' });
      res.json({ success: true, data: user.settings || {} });
    } catch (error) {
      res.status(500).json({ success: false, error: errorMessage(error) });
    }
  },

  updateProfile: async (req, res) => {
    try {
      const { username, displayName, avatar, bio, timezone, timezoneManual } = req.body || {};

      const invalid = (username !== undefined ? checkUsername(username) : null)
        ?? checkOptionalString(displayName, 'Display name', 30)
        ?? checkOptionalString(bio, 'Bio', 160)
        ?? checkAvatar(avatar)
        ?? checkTimezone(timezone)
        ?? (timezoneManual !== undefined && typeof timezoneManual !== 'boolean' ? 'Invalid timezone setting' : null);
      if (invalid) {
        return res.status(400).json({ success: false, error: invalid });
      }

      const updateData = { username, displayName, avatar, bio };
      if (timezone !== undefined) updateData.timezone = timezone;
      if (timezoneManual !== undefined) updateData.timezoneManual = timezoneManual;

      const user = await updateProfile(req.userId, updateData);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      const status = error.message.includes('taken') ? 409 : 500;
      res.status(status).json({
        success: false,
        error: errorMessage(error, status),
      });
    }
  },

  /**
   * Get user leaderboard
   * GET /api/users/leaderboard
   */
  getLeaderboard: async (req, res) => {
    try {
      const { limit = 10, sortBy = 'highScore' } = req.query;

      const leaderboard = await getLeaderboard(clampInt(limit, 10, 1, 100), asString(sortBy));

      res.json({
        success: true,
        data: leaderboard,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error),
      });
    }
  },

  /**
   * Delete user account
   * DELETE /api/users/account
   */
  deleteAccount: async (req, res) => {
    try {
      const deleted = await deleteAccount(req.userId);

      res.json({
        success: true,
        data: { deleted },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error),
      });
    }
  },

  /**
   * Search users by username (public)
   * GET /api/users/search?q=username
   */
  searchUsers: async (req, res) => {
    try {
      const { q, limit = 20 } = req.query;

      const query = asString(q);
      if (query && query.length > 50) {
        return res.status(400).json({ success: false, error: 'Search is too long' });
      }
      const users = await searchUsers(query, clampInt(limit, 20, 1, 50));

      res.json({
        success: true,
        data: users,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error),
      });
    }
  },

  /**
   * Get user's public profile
   * GET /api/users/:userId
   */
  getPublicProfile: async (req, res) => {
    try {
      const { userId } = req.params;

      const user = await getPublicProfile(userId, req.userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        });
      }

      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error),
      });
    }
  },

  /**
   * Follow a user
   * POST /api/users/:userId/follow
   */
  follow: async (req, res) => {
    try {
      const { userId } = req.params;

      const data = await followUser(req.userId, userId);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      const status = error.message.includes('follow yourself') || error.message.includes('not found') ? 400 : 500;
      res.status(status).json({
        success: false,
        error: errorMessage(error, status),
      });
    }
  },

  /**
   * Unfollow a user
   * DELETE /api/users/:userId/follow
   */
  unfollow: async (req, res) => {
    try {
      const { userId } = req.params;

      const data = await unfollowUser(req.userId, userId);

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      const status = error.message.includes('unfollow yourself') ? 400 : 500;
      res.status(status).json({
        success: false,
        error: errorMessage(error, status),
      });
    }
  },

  /**
   * Get a user's followers
   * GET /api/users/:userId/followers
   */
  getFollowers: async (req, res) => {
    try {
      const { userId } = req.params;

      const users = await getFollowers(userId);

      res.json({
        success: true,
        data: users,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error),
      });
    }
  },

  /**
   * Get users that a user follows
   * GET /api/users/:userId/following
   */
  getFollowing: async (req, res) => {
    try {
      const { userId } = req.params;

      const users = await getFollowing(userId);

      res.json({
        success: true,
        data: users,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: errorMessage(error),
      });
    }
  },
};

export default userController;
