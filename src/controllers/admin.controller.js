import {
  getAllUsers,
  getUserById,
  updateUserRole,
  updateUserStatus,
  deactivateUser,
  banUser,
  reactivateUser,
  deleteUser,
  getDashboardStats,
} from '../services/admin.service.js';

const adminController = {
  /**
   * Get dashboard stats
   * GET /api/admin/dashboard
   */
  getDashboard: async (req, res) => {
    try {
      const stats = await getDashboardStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * Get all users
   * GET /api/admin/users
   */
  getAllUsers: async (req, res) => {
    try {
      const { page = 1, limit = 20, role, status, search } = req.query;

      const result = await getAllUsers(parseInt(page), parseInt(limit), {
        role,
        status,
        search,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * Get user by ID
   * GET /api/admin/users/:userId
   */
  getUserById: async (req, res) => {
    try {
      const { userId } = req.params;

      const user = await getUserById(userId);

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
   * Update user role
   * PATCH /api/admin/users/:userId/role
   */
  updateUserRole: async (req, res) => {
    try {
      const { userId } = req.params;
      const { role } = req.body;

      if (!role) {
        return res.status(400).json({
          success: false,
          error: 'Role is required',
        });
      }

      const user = await updateUserRole(userId, role, req.userId);

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
      const status = error.message.includes('Cannot') || error.message.includes('Invalid') ? 400 : 500;
      res.status(status).json({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * Update user status
   * PATCH /api/admin/users/:userId/status
   */
  updateUserStatus: async (req, res) => {
    try {
      const { userId } = req.params;
      const { status, reason } = req.body;

      if (!status) {
        return res.status(400).json({
          success: false,
          error: 'Status is required',
        });
      }

      const user = await updateUserStatus(userId, status, reason || '', req.userId);

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
      const status = error.message.includes('Cannot') || error.message.includes('Only') ? 403 : 500;
      res.status(status).json({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * Deactivate user
   * POST /api/admin/users/:userId/deactivate
   */
  deactivateUser: async (req, res) => {
    try {
      const { userId } = req.params;
      const { reason } = req.body;

      const user = await deactivateUser(userId, reason || '', req.userId);

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
      const status = error.message.includes('Cannot') || error.message.includes('Only') ? 403 : 500;
      res.status(status).json({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * Ban user
   * POST /api/admin/users/:userId/ban
   */
  banUser: async (req, res) => {
    try {
      const { userId } = req.params;
      const { reason } = req.body;

      const user = await banUser(userId, reason || '', req.userId);

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
      const status = error.message.includes('Cannot') || error.message.includes('Only') ? 403 : 500;
      res.status(status).json({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * Reactivate user
   * POST /api/admin/users/:userId/reactivate
   */
  reactivateUser: async (req, res) => {
    try {
      const { userId } = req.params;

      const user = await reactivateUser(userId, req.userId);

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
   * Delete user permanently
   * DELETE /api/admin/users/:userId
   */
  deleteUser: async (req, res) => {
    try {
      const { userId } = req.params;

      const deleted = await deleteUser(userId, req.userId);

      res.json({
        success: true,
        data: { deleted },
      });
    } catch (error) {
      const status = error.message.includes('Cannot') || error.message.includes('Only') ? 403 : 500;
      res.status(status).json({
        success: false,
        error: error.message,
      });
    }
  },
};

export default adminController;
