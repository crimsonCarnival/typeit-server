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

const userController = {
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
        error: error.message,
      });
    }
  },

  /**
   * Update current user profile
   * PATCH /api/users/profile
   */
  updateProfile: async (req, res) => {
    try {
      const { username, displayName, avatar, bio, timezone } = req.body;

      const updateData = { username, displayName, avatar, bio };
      if (timezone !== undefined) updateData.timezone = timezone;

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
        error: error.message,
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

      const leaderboard = await getLeaderboard(parseInt(limit), sortBy);

      res.json({
        success: true,
        data: leaderboard,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
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
        error: error.message,
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

      const users = await searchUsers(q, parseInt(limit));

      res.json({
        success: true,
        data: users,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
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
        error: error.message,
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
        error: error.message,
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
        error: error.message,
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
        error: error.message,
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
        error: error.message,
      });
    }
  },
};

export default userController;
