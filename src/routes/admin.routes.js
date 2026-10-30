import express from 'express';
import adminController from '../controllers/admin.controller.js';
import moderation from '../controllers/admin-moderation.controller.js';
import { auth, requirePermission } from '../middleware/auth.middleware.js';
import { requireObjectIdParam } from '../middleware/params.middleware.js';
import { USAGE_RANGES } from '../config/usage.js';
import { series, seriesKeys, summary } from '../services/usage.service.js';

const router = express.Router();

// Every admin route needs a signed-in user holding the permission it names
// (config/permissions.js). Moderators get theirs from their role; anyone can
// be given or denied single ones.
router.use(auth);
router.param('userId', requireObjectIdParam('User not found'));

const can = (...permissions) => requirePermission('admin.access', ...permissions);

// What the admin area can hand out
router.get('/permissions', can(), moderation.catalog);

// Dashboard
router.get('/dashboard', can('users.view'), adminController.getDashboard);

// Users
router.get('/users', can('users.view'), adminController.getAllUsers);
router.get('/users/:userId', can('users.view'), adminController.getUserById);
router.patch('/users/:userId/role', can('users.role'), adminController.updateUserRole);
router.put('/users/:userId/permissions', can('users.permissions'), moderation.setPermissions);
router.patch('/users/:userId/status', can('users.moderate'), adminController.updateUserStatus);
router.post('/users/:userId/xp', can('users.xp'), moderation.grantXp);
router.post('/users/:userId/warn', can('users.moderate'), moderation.warn);
router.post('/users/:userId/deactivate', can('users.moderate'), adminController.deactivateUser);
router.post('/users/:userId/ban', can('users.moderate'), adminController.banUser);
router.post('/users/:userId/reactivate', can('users.moderate'), adminController.reactivateUser);
router.post('/users/:userId/profile-reset', can('content.moderate'), moderation.resetProfile);
router.delete('/users/:userId', can('users.delete'), adminController.deleteUser);

// Live race rooms
router.get('/races', can('race.moderate'), moderation.races);
router.post('/races/:code/moderate', can('race.moderate'), moderation.moderateRace);

// Release notes (founders only; checked in the handler)
router.post('/changelog/refresh', can(), moderation.refreshChangelog);

// Audit log
router.get('/audit', can('audit.view'), moderation.audit);

// Usage statistics: ?range=7|30|90 &who=all|guests|signed-in
const usageQuery = (req) => ({
  range: USAGE_RANGES.includes(Number(req.query.range)) ? Number(req.query.range) : 30,
  who: ['all', 'guests', 'signed-in'].includes(req.query.who) ? req.query.who : 'all',
});
router.get('/usage/summary', can('usage.view'), async (req, res, next) => {
  try {
    res.json({ success: true, data: await summary(usageQuery(req)) });
  } catch (err) {
    next(err);
  }
});
// &keys=k1,k2 (up to 5 features or details)
router.get('/usage/series', can('usage.view'), async (req, res, next) => {
  try {
    const valid = seriesKeys();
    const keys = [...new Set(String(req.query.keys || '').split(','))].filter((k) => valid.has(k)).slice(0, 5);
    if (!keys.length) return res.status(400).json({ success: false, error: 'Pick at least one feature' });
    res.json({ success: true, data: await series({ ...usageQuery(req), keys }) });
  } catch (err) {
    next(err);
  }
});

export default router;
