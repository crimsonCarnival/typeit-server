import express from 'express';
import authController from '../controllers/auth.controller.js';
import { auth } from '../middleware/auth.middleware.js';
import { rateLimit } from '../middleware/rateLimit.middleware.js';

const router = express.Router();

router.post('/register', rateLimit(), authController.register);
router.post('/login', rateLimit(), authController.login);
router.get('/me', auth, authController.me);
router.post('/verify', rateLimit({ windowMs: 60 * 1000, max: 30 }), authController.verify);

export default router;
