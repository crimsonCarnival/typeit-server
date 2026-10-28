import express from 'express';
import rankingsController from '../controllers/rankings.controller.js';
import { optionalAuth } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', optionalAuth, rankingsController.list);

export default router;
