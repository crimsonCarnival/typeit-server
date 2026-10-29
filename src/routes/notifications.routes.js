import express from 'express';
import { auth } from '../middleware/auth.middleware.js';
import { clampInt } from '../utils/http.js';
import { catchUpNotifications } from '../services/notification-catchup.js';
import { getPreferences, listNotifications, markRead, setPreferences, unreadCount } from '../services/notification.service.js';

const router = express.Router();

router.use(auth);

const fail = (res) => res.status(500).json({ success: false, error: 'Could not load notifications' });

/**
 * GET /api/notifications?limit&before
 * The inbox, newest first, with the unread count.
 */
router.get('/', async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 30, 1, 100);
    const before = typeof req.query.before === 'string' ? req.query.before : null;
    // Opening the inbox is when anything the player hasn't been told yet gets sent.
    if (!before) await catchUpNotifications(req.user._id);
    const [notifications, unread] = await Promise.all([listNotifications(req.user._id, { limit, before }), unreadCount(req.user._id)]);
    res.json({ success: true, data: { notifications, unread } });
  } catch {
    fail(res);
  }
});

/**
 * POST /api/notifications/read  { ids?: string[] }
 * Marks some (or, without ids, all) notifications read.
 */
router.post('/read', async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 100 || !ids.every((id) => typeof id === 'string'))) {
      return res.status(400).json({ success: false, error: 'Invalid ids' });
    }
    res.json({ success: true, data: { unread: await markRead(req.user._id, ids ?? null) } });
  } catch {
    fail(res);
  }
});

/** GET /api/notifications/preferences */
router.get('/preferences', async (req, res) => {
  try {
    res.json({ success: true, data: await getPreferences(req.user._id) });
  } catch {
    fail(res);
  }
});

/**
 * PUT /api/notifications/preferences  { social?, achievements?, races?, daily? }
 * Account notices can't be muted, so they aren't listed.
 */
router.put('/preferences', async (req, res) => {
  try {
    res.json({ success: true, data: await setPreferences(req.user._id, req.body) });
  } catch {
    fail(res);
  }
});

export default router;
