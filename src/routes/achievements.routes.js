import express from 'express';
import achievementsController from '../controllers/achievements.controller.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', auth, achievementsController.list);

export default router;
