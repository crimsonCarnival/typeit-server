import express from 'express';
import learnController from '../controllers/learn.controller.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(auth);
router.get('/', learnController.overview);
router.post('/start', learnController.start);
router.post('/lists', learnController.createList);
router.put('/lists/:id', learnController.updateList);
router.delete('/lists/:id', learnController.deleteList);

export default router;
