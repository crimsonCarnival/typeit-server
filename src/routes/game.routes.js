import express from 'express';
import gameController from '../controllers/game.controller.js';
import errorMapController from '../controllers/error-map.controller.js';
import { auth, optionalAuth } from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/start', optionalAuth, gameController.startGame);
router.post('/begin', auth, gameController.beginGame);
router.post('/drill', auth, errorMapController.drill);
router.get('/leaderboard', gameController.getLeaderboard);
router.post('/end', optionalAuth, gameController.endGame);
router.post('/reset', optionalAuth, gameController.resetGame);
router.post('/refresh', optionalAuth, gameController.refreshText);
router.patch('/session', auth, gameController.saveSessionState);
router.post('/migrate', auth, gameController.migrateGame);
router.patch('/settings', auth, gameController.updateSettings);
router.delete('/delete', auth, gameController.deleteGame);
router.post('/state', optionalAuth, gameController.getGameState);

export default router;
