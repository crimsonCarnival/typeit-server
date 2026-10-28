import { register, login, verifyToken } from '../services/auth.service.js';

/**
 * Public shape of a user returned to the client. Never includes password.
 */
export const toPublicUser = (user) => ({
  id: user._id,
  username: user.username,
  displayName: user.displayName || user.username,
  email: user.email,
  avatar: user.avatar,
  bio: user.bio || '',
  role: user.role,
  timezone: user.timezone,
  stats: user.stats,
  followers: user.followers?.length || 0,
  following: user.following?.length || 0,
  createdAt: user.createdAt,
});

const authController = {
  /**
   * Register a new user
   * POST /api/auth/register
   */
  register: async (req, res) => {
    try {
      const { username, email, password, displayName } = req.body;

      if (!username || !email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username, email and password are required',
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 6 characters',
        });
      }

      const result = await register(username, email, password, displayName);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      const status = error.message.includes('already') ? 409 : 500;
      res.status(status).json({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * Login user
   * POST /api/auth/login
   */
  login: async (req, res) => {
    try {
      const { email, username, password } = req.body;
      const identifier = email || username;

      if (!identifier || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email/username and password are required',
        });
      }

      const result = await login(identifier, password);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      const status = error.message === 'Invalid credentials' ? 401 : 500;
      res.status(status).json({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * Get current user from token
   * GET /api/auth/me
   */
  me: async (req, res) => {
    try {
      res.json({
        success: true,
        data: {
          user: toPublicUser(req.user),
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },

  /**
   * Verify token validity
   * POST /api/auth/verify
   */
  verify: async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({
          success: false,
          error: 'Token is required',
        });
      }

      const user = await verifyToken(token);

      res.json({
        success: true,
        data: {
          valid: true,
          user: toPublicUser(user),
        },
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        error: 'Invalid token',
      });
    }
  },
};

export default authController;
