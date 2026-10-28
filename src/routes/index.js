import express from 'express';
import gameRoutes from './game.routes.js';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import adminRoutes from './admin.routes.js';
import statsRoutes from './stats.routes.js';
import rankingsRoutes from './rankings.routes.js';
import dailyRoutes from './daily.routes.js';
import achievementsRoutes from './achievements.routes.js';

const router = express.Router();

router.use('/game', gameRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/admin', adminRoutes);
router.use('/stats', statsRoutes);
router.use('/rankings', rankingsRoutes);
router.use('/daily', dailyRoutes);
router.use('/achievements', achievementsRoutes);

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export { router };
