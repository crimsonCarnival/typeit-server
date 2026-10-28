import express from 'express';
import userController from '../controllers/user.controller.js';
import { auth, optionalAuth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Fixed public routes
router.get('/leaderboard', userController.getLeaderboard);
router.get('/search', userController.searchUsers);

// Protected fixed routes (require authentication)
router.get('/profile', auth, userController.getProfile);
router.patch('/profile', auth, userController.updateProfile);
router.delete('/account', auth, userController.deleteAccount);

// Param routes (must be registered after fixed routes)
router.get('/:userId/followers', userController.getFollowers);
router.get('/:userId/following', userController.getFollowing);
router.post('/:userId/follow', auth, userController.follow);
router.delete('/:userId/follow', auth, userController.unfollow);
router.get('/:userId', optionalAuth, userController.getPublicProfile);

export default router;
