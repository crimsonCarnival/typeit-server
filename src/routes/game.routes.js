import express from 'express';
import gameController from '../controllers/game.controller.js';
import errorMapController from '../controllers/error-map.controller.js';
import { auth, optionalAuth } from '../middleware/auth.middleware.js';
import { listCategories } from '../services/text-library.service.js';
import { rateLimit } from '../middleware/rateLimit.middleware.js';

// Finishing a run is the expensive request (keystroke replay, stats, badges).
const endLimit = rateLimit({ windowMs: 60 * 1000, max: 30, perUser: true });
// Live progress arrives about once a second while typing.
const progressLimit = rateLimit({ windowMs: 60 * 1000, max: 150, perUser: true });

const router = express.Router();

router.post('/start', optionalAuth, gameController.startGame);
router.post('/progress', optionalAuth, progressLimit, gameController.progress);
router.post('/drill', auth, errorMapController.drill);
router.get('/leaderboard', gameController.getLeaderboard);
// Phrases-mode text categories for the client's text-source menu.
router.get('/texts', (req, res) => res.json({ success: true, data: { categories: listCategories() } }));
router.post('/end', optionalAuth, endLimit, gameController.endGame);
router.post('/reset', optionalAuth, gameController.resetGame);
router.post('/refresh', optionalAuth, gameController.refreshText);
router.post('/migrate', auth, gameController.migrateGame);
router.patch('/settings', auth, gameController.updateSettings);
router.delete('/delete', auth, gameController.deleteGame);
router.post('/state', optionalAuth, gameController.getGameState);

export default router;
