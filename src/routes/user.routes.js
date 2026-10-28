import express from 'express';
import userController from '../controllers/user.controller.js';
import { auth, optionalAuth } from '../middleware/auth.middleware.js';
import { rateLimit } from '../middleware/rateLimit.middleware.js';
import { requireObjectIdParam } from '../middleware/params.middleware.js';

const router = express.Router();

router.param('userId', requireObjectIdParam('User not found'));

// Fixed public routes
router.get('/leaderboard', userController.getLeaderboard);
router.get('/search', rateLimit({ windowMs: 60 * 1000, max: 60 }), userController.searchUsers);

// Protected fixed routes (require authentication)
router.get('/profile', auth, userController.getProfile);
router.patch('/profile', auth, rateLimit({ windowMs: 60 * 1000, max: 20, perUser: true }), userController.updateProfile);
router.delete('/account', auth, rateLimit({ windowMs: 60 * 60 * 1000, max: 5, perUser: true }), userController.deleteAccount);

// Param routes (must be registered after fixed routes)
router.get('/:userId/followers', userController.getFollowers);
router.get('/:userId/following', userController.getFollowing);
router.post('/:userId/follow', auth, rateLimit({ windowMs: 60 * 1000, max: 30, perUser: true }), userController.follow);
router.delete('/:userId/follow', auth, rateLimit({ windowMs: 60 * 1000, max: 30, perUser: true }), userController.unfollow);
router.get('/:userId', optionalAuth, userController.getPublicProfile);

export default router;
