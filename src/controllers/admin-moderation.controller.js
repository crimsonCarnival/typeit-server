import { AdminError, PERMISSION_CATALOG, moderateProfile, setPermissionOverrides, warnUser } from '../services/admin.service.js';
import { listAudit, recordAudit } from '../services/audit.service.js';
import { listRoomsForAdmin, moderateRoom } from '../services/race/race-manager.js';
import { permissionsFor, ROLE_PERMISSIONS } from '../config/permissions.js';
import { asString, clampInt } from '../utils/http.js';
import User from '../models/user.model.js';
import { rankOf } from '../config/permissions.js';

const fail = (res, error) => {
  if (error instanceof AdminError) return res.status(error.status).json({ success: false, error: error.message });
  console.error('[admin]', error?.message || error);
  return res.status(500).json({ success: false, error: 'Something went wrong' });
};

const notFound = (res) => res.status(404).json({ success: false, error: 'User not found' });

const ROOM_ERRORS = {
  'room-not-found': [404, 'That room no longer exists'],
  'not-in-room': [404, 'That player is not in the room'],
  'bad-action': [400, 'Unknown action'],
};

const adminModerationController = {
  /** GET /api/admin/permissions: what exists and what each role starts with. */
  catalog: (req, res) => {
    res.json({ success: true, data: { permissions: PERMISSION_CATALOG, roles: ROLE_PERMISSIONS } });
  },

  /** POST /api/admin/users/:userId/warn  { reason } */
  warn: async (req, res) => {
    try {
      const user = await warnUser(req.params.userId, asString(req.body?.reason), req.userId);
      if (!user) return notFound(res);
      res.json({ success: true, data: { warned: true } });
    } catch (error) {
      fail(res, error);
    }
  },

  /** PUT /api/admin/users/:userId/permissions  { grants: string[], revokes: string[] } */
  setPermissions: async (req, res) => {
    try {
      const { grants = [], revokes = [] } = req.body ?? {};
      if (!Array.isArray(grants) || !Array.isArray(revokes) || grants.length > 20 || revokes.length > 20) {
        throw new AdminError('Invalid permissions');
      }
      const user = await setPermissionOverrides(req.params.userId, { grants, revokes }, req.userId);
      if (!user) return notFound(res);
      res.json({ success: true, data: { user, permissions: permissionsFor(user) } });
    } catch (error) {
      fail(res, error);
    }
  },

  /** POST /api/admin/users/:userId/profile-reset  { fields: string[], reason } */
  resetProfile: async (req, res) => {
    try {
      const user = await moderateProfile(req.params.userId, req.body?.fields, asString(req.body?.reason), req.userId);
      if (!user) return notFound(res);
      res.json({ success: true, data: user });
    } catch (error) {
      fail(res, error);
    }
  },

  /** GET /api/admin/audit?page&limit&target&actor&action */
  audit: async (req, res) => {
    try {
      const { page, limit, target, actor, action } = req.query;
      const data = await listAudit(clampInt(page, 1, 1, 10_000), clampInt(limit, 30, 1, 100), {
        targetId: asString(target),
        actorId: asString(actor),
        action: asString(action)?.slice(0, 40),
      });
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error);
    }
  },

  /** GET /api/admin/races: every open room. */
  races: (req, res) => {
    res.json({ success: true, data: { rooms: listRoomsForAdmin() } });
  },

  /** POST /api/admin/races/:code/moderate  { action: 'kick'|'mute'|'unmute', userId, reason } */
  moderateRace: async (req, res) => {
    try {
      const { action, userId } = req.body ?? {};
      if (typeof userId !== 'string') return res.status(400).json({ success: false, error: 'userId is required' });
      // Same rank rule as everywhere: no muting or removing someone of equal or higher rank.
      const target = await User.findById(userId).select('role').lean();
      if (target && rankOf(target.role) >= rankOf(req.user.role)) {
        return res.status(403).json({ success: false, error: 'You can only moderate players of a lower rank than yours' });
      }
      const err = moderateRoom(req.params.code, { action, userId });
      if (err) {
        const [status, message] = ROOM_ERRORS[err] ?? [400, 'Could not do that'];
        return res.status(status).json({ success: false, error: message });
      }
      await recordAudit(req.userId, `race.${action}`, { targetId: userId, reason: asString(req.body?.reason) ?? '', details: { room: req.params.code } });
      res.json({ success: true, data: { done: true } });
    } catch (error) {
      fail(res, error);
    }
  },
};

export default adminModerationController;
