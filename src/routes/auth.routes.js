import express from 'express';
import authController from '../controllers/auth.controller.js';
import { auth, optionalAuth } from '../middleware/auth.middleware.js';
import account from '../controllers/account.controller.js';
import { rateLimit } from '../middleware/rateLimit.middleware.js';

const router = express.Router();

router.post('/register', rateLimit(), authController.register);
router.post('/login', rateLimit(), authController.login);
router.get('/me', auth, authController.me);
// Google sign-in and sign-in methods
router.get('/google/enabled', account.googleEnabled);
router.post('/google/url', rateLimit({ windowMs: 60 * 1000, max: 20 }), optionalAuth, account.googleUrl);
router.get('/google/callback', rateLimit({ windowMs: 60 * 1000, max: 20 }), account.googleCallback);
router.post('/google/link', auth, rateLimit({ windowMs: 60 * 1000, max: 10, perUser: true }), account.linkGoogle);
router.delete('/google', auth, account.unlinkGoogle);
router.post('/password', auth, rateLimit({ windowMs: 15 * 60 * 1000, max: 10, perUser: true }), account.setPassword);
router.post('/email', auth, rateLimit({ windowMs: 15 * 60 * 1000, max: 10, perUser: true }), account.setEmail);
router.post('/revoke-all', auth, account.revokeAll);

router.post('/verify', rateLimit({ windowMs: 60 * 1000, max: 30 }), authController.verify);

export default router;
