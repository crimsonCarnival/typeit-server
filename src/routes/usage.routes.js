import express from 'express';
import { optionalAuth } from '../middleware/auth.middleware.js';
import { rateLimit } from '../middleware/rateLimit.middleware.js';
import { recordClientEvents } from '../services/usage.service.js';

const router = express.Router();

/**
 * POST /api/usage/events  { visitorId, events: [{ key }] }
 * Page views and other things only the browser sees. Always 204, so it says
 * nothing about what was kept.
 */
router.post('/events', rateLimit({ windowMs: 60 * 1000, max: 30 }), optionalAuth, (req, res) => {
  recordClientEvents({ visitorId: req.body?.visitorId, events: req.body?.events, ip: req.ip, user: req.user ?? null });
  res.status(204).end();
});

export default router;
