import express from 'express';
import statsController from '../controllers/stats.controller.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

// GET /api/stats/history — authenticated user's session history
router.get('/history', auth, statsController.getHistory);

export default router;
