import express from 'express';
import learnController from '../controllers/learn.controller.js';
import { auth } from '../middleware/auth.middleware.js';
import { rateLimit } from '../middleware/rateLimit.middleware.js';

const listWrites = rateLimit({ windowMs: 60 * 1000, max: 30, perUser: true });

const router = express.Router();

router.use(auth);
router.get('/', learnController.overview);
router.post('/start', learnController.start);
router.post('/lists', listWrites, learnController.createList);
router.put('/lists/:id', listWrites, learnController.updateList);
router.delete('/lists/:id', listWrites, learnController.deleteList);

export default router;
