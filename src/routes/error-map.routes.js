import express from 'express';
import errorMapController from '../controllers/error-map.controller.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', auth, errorMapController.get);

export default router;
