import express from 'express';
import statsController from '../controllers/stats.controller.js';
import { auth } from '../middleware/auth.middleware.js';

import { getGlobalStats } from '../services/global-stats.service.js';

const router = express.Router();

// GET /api/stats/global — site-wide totals and the 60s speed distribution (public, cached)
router.get('/global', async (req, res) => {
  try {
    res.json({ success: true, data: await getGlobalStats() });
  } catch {
    res.status(500).json({ success: false, error: 'Could not load the statistics' });
  }
});

// GET /api/stats/history — authenticated user's session history
router.get('/history', auth, statsController.getHistory);

// GET /api/stats/results — every result of the signed-in player, for the stats dashboard
router.get('/results', auth, statsController.getResults);

export default router;
