import express from 'express';
import userController from '../controllers/user.controller.js';
import { auth, optionalAuth } from '../middleware/auth.middleware.js';
import { rateLimit } from '../middleware/rateLimit.middleware.js';
import { requireObjectIdParam } from '../middleware/params.middleware.js';
import account from '../controllers/account.controller.js';

const router = express.Router();

router.param('userId', requireObjectIdParam('User not found'));

// Fixed public routes
router.get('/leaderboard', userController.getLeaderboard);
router.get('/search', rateLimit({ windowMs: 60 * 1000, max: 60 }), userController.searchUsers);

// Protected fixed routes (require authentication)
router.get('/profile', auth, userController.getProfile);
router.get('/profile/outcomes', auth, userController.getOutcomes);
router.patch('/profile', auth, rateLimit({ windowMs: 60 * 1000, max: 20, perUser: true }), userController.updateProfile);
router.get('/settings', auth, userController.getSettings);
router.patch('/settings', auth, rateLimit({ windowMs: 60 * 1000, max: 60, perUser: true }), userController.updateSettings);
router.delete('/account', auth, rateLimit({ windowMs: 60 * 60 * 1000, max: 5, perUser: true }), userController.deleteAccount);
router.post('/account/username', auth, rateLimit({ windowMs: 60 * 60 * 1000, max: 10, perUser: true }), account.changeUsername);
router.post('/account/streak-offset', auth, account.setStreakOffset);
router.post('/account/leaderboard-opt-out', auth, account.optOut);
router.post('/account/usage-opt-out', auth, rateLimit({ windowMs: 60 * 1000, max: 20, perUser: true }), account.usageOptOut);
router.post('/account/reset-pbs', auth, rateLimit({ windowMs: 60 * 60 * 1000, max: 5, perUser: true }), account.resetPersonalBests);
router.get('/blocks', auth, account.listBlocks);
router.post('/account/reset', auth, rateLimit({ windowMs: 60 * 60 * 1000, max: 5, perUser: true }), userController.resetAccount);

// Param routes (must be registered after fixed routes)
router.post('/:userId/block', auth, rateLimit({ windowMs: 60 * 1000, max: 30, perUser: true }), account.block);
router.delete('/:userId/block', auth, account.unblock);
router.get('/:userId/overview', userController.getOverview);
router.get('/:userId/followers', userController.getFollowers);
router.get('/:userId/following', userController.getFollowing);
router.post('/:userId/follow', auth, rateLimit({ windowMs: 60 * 1000, max: 30, perUser: true }), userController.follow);
router.delete('/:userId/follow', auth, rateLimit({ windowMs: 60 * 1000, max: 30, perUser: true }), userController.unfollow);
router.get('/:userId', optionalAuth, userController.getPublicProfile);

export default router;
