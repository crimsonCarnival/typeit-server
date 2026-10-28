import express from 'express';
import dailyController from '../controllers/daily.controller.js';
import { auth, optionalAuth } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', optionalAuth, dailyController.overview);
router.post('/start', auth, dailyController.start);
router.post('/ghost', auth, dailyController.ghost);

export default router;
