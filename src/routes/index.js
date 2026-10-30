import { CONTACT_EMAIL } from '../config/env.js';
import express from 'express';
import gameRoutes from './game.routes.js';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import adminRoutes from './admin.routes.js';
import statsRoutes from './stats.routes.js';
import rankingsRoutes from './rankings.routes.js';
import dailyRoutes from './daily.routes.js';
import achievementsRoutes from './achievements.routes.js';
import errorMapRoutes from './error-map.routes.js';
import learnRoutes from './learn.routes.js';
import raceRoutes from './race.routes.js';
import replayRoutes from './replay.routes.js';
import notificationRoutes from './notifications.routes.js';
import changelogRoutes from './changelog.routes.js';
import usageRoutes from './usage.routes.js';

const router = express.Router();

router.use('/game', gameRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/admin', adminRoutes);
router.use('/stats', statsRoutes);
router.use('/rankings', rankingsRoutes);
router.use('/daily', dailyRoutes);
router.use('/achievements', achievementsRoutes);
router.use('/error-map', errorMapRoutes);
router.use('/learn', learnRoutes);
router.use('/race', raceRoutes);
router.use('/replays', replayRoutes);
router.use('/notifications', notificationRoutes);
router.use('/changelog', changelogRoutes);
router.use('/usage', usageRoutes);

// Public facts about the site the client needs at runtime.
router.get('/site', (req, res) => {
  res.json({ success: true, data: { contactEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(CONTACT_EMAIL) ? CONTACT_EMAIL : '' } });
});

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export { router };
