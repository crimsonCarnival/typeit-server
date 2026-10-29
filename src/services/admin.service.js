import User from '../models/user.model.js';
import { deleteAccount } from './user.service.js';
import { recordAudit } from './audit.service.js';
import { notify } from './notification.service.js';
import { awardXp } from './xp.service.js';
import { XP_GRANT_MAX } from '../config/levels.js';
import { FULL_ACCESS_ROLES, PERMISSIONS, ROLES, ROLE_PERMISSIONS, isDelegable, isValidPermission, permissionsFor, rankOf } from '../config/permissions.js';

/** A refused admin action; `status` is the HTTP status to answer with. */
export class AdminError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * You can only act on someone of lower rank, and nobody can act on a founder
 * (founders exist only through the FOUNDER_USERNAMES setting). Returns the actor.
 */
const guardTarget = async (target, actorId, what) => {
  if (target.role === 'founder') throw new AdminError('Founders can only be changed through the server settings', 403);
  const actor = await User.findById(actorId).select('role permissionGrants permissionRevokes');
  if (rankOf(actor?.role) <= rankOf(target.role)) throw new AdminError(`You can only ${what} players of a lower rank than yours`, 403);
  return actor;
};

// The notice an audited action causes and the catch-up that might find it later share this key, so it lands once.
export const auditKey = (logId) => (logId ? `audit:${logId}` : null);

const MAX_REASON = 500;
const cleanReason = (reason) => String(reason ?? '').trim().slice(0, MAX_REASON);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Gets all users with pagination and filters
 */
export const getAllUsers = async (page = 1, limit = 20, filters = {}) => {
  const query = {};
  
  if (filters.role) query.role = filters.role;
  if (filters.status) query.status = filters.status;
  if (filters.search) {
    query.$or = [
      { username: { $regex: escapeRegex(filters.search), $options: 'i' } },
      { email: { $regex: escapeRegex(filters.search), $options: 'i' } },
    ];
  }

  const skip = (page - 1) * limit;
  
  const [users, total] = await Promise.all([
    User.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-password'),
    User.countDocuments(query),
  ]);

  return {
    users,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

/**
 * Gets user by ID
 */
export const getUserById = async (userId) => {
  return await User.findById(userId).select('-password');
};

/**
 * Updates user role
 */
export const updateUserRole = async (userId, role, adminId) => {
  if (userId === adminId.toString()) {
    throw new Error('Cannot change your own role');
  }

  if (!ROLES.includes(role)) {
    throw new Error('Invalid role');
  }
  if (role === 'founder') throw new AdminError('Founders can only be set through the server settings', 400);

  const target = await User.findById(userId).select('role');
  if (!target) return null;
  // Roles are for admins and founders only (not delegable), and only downward:
  // act on someone below you, give a role below yours.
  const actor = await guardTarget(target, adminId, 'change the role of');
  if (rankOf(actor?.role) < rankOf('admin')) throw new AdminError('Only admins can change roles', 403);
  if (rankOf(role) >= rankOf(actor.role)) throw new AdminError('You can only give a role below your own', 403);

  const user = await User.findByIdAndUpdate(userId, { $set: { role } }, { new: true }).select('-password');
  if (target.role !== role) {
    const logId = await recordAudit(adminId, 'user.role', { targetId: userId, details: { from: target.role, to: role } });
    await notify(userId, { type: 'account', title: `Your role is now ${role}`, body: target.role === 'user' || role === 'admin' ? 'You may have new tools in the admin area.' : '', link: role === 'user' ? '/profile' : '/admin', dedupeKey: auditKey(logId) });
  }
  return user;
};

/**
 * Updates user status (active, deactivated, banned)
 */
export const updateUserStatus = async (userId, status, reason = '', adminId) => {
  if (userId === adminId.toString()) {
    throw new Error('Cannot change your own status');
  }

  const validStatuses = ['active', 'deactivated', 'banned'];
  if (!validStatuses.includes(status)) {
    throw new Error('Invalid status');
  }

  const user = await User.findById(userId);
  if (!user) return null;

  await guardTarget(user, adminId, 'change the status of');

  const updates = {
    status,
    statusChangedAt: status === 'active' ? null : new Date(),
    statusReason: status === 'active' ? '' : reason,
  };

  const updated = await User.findByIdAndUpdate(userId, { $set: updates }, { new: true }).select('-password');
  if (user.status !== status) {
    const logId = await recordAudit(adminId, `user.${status === 'active' ? 'reactivate' : status === 'banned' ? 'ban' : 'deactivate'}`, { targetId: userId, reason, details: { from: user.status, to: status } });
    const titles = { active: 'Your account was reactivated', banned: 'Your account was banned', deactivated: 'Your account was deactivated' };
    await notify(userId, { type: 'account', title: titles[status], body: reason || '', link: '/account', dedupeKey: auditKey(logId) });
  }
  return updated;
};

/**
 * Deactivates a user account
 */
export const deactivateUser = async (userId, reason = '', adminId) => {
  return await updateUserStatus(userId, 'deactivated', reason, adminId);
};

/**
 * Bans a user account
 */
export const banUser = async (userId, reason = '', adminId) => {
  return await updateUserStatus(userId, 'banned', reason, adminId);
};

/**
 * Reactivates a user account
 */
export const reactivateUser = async (userId, adminId) => {
  return await updateUserStatus(userId, 'active', '', adminId);
};

/**
 * Deletes a user permanently
 */
export const deleteUser = async (userId, adminId) => {
  if (userId === adminId.toString()) {
    throw new Error('Cannot delete your own account');
  }

  const user = await User.findById(userId);
  if (!user) return false;

  await guardTarget(user, adminId, 'delete');

  // Same cleanup as a self-service deletion (runs, follows, progress...).
  const deleted = await deleteAccount(userId);
  if (deleted) await recordAudit(adminId, 'user.delete', { targetId: userId, details: { username: user.username } });
  return deleted;
};

/** Formal warning: recorded, and the player is told why. */
export const warnUser = async (userId, reason, adminId) => {
  const why = cleanReason(reason);
  if (!why) throw new AdminError('A reason is required');
  if (String(userId) === String(adminId)) throw new AdminError('You cannot warn yourself');
  const user = await User.findById(userId).select('role status');
  if (!user) return null;
  await guardTarget(user, adminId, 'warn');
  const logId = await recordAudit(adminId, 'user.warn', { targetId: userId, reason: why });
  await notify(userId, { type: 'account', title: 'You received a warning', body: why, link: '/account', dedupeKey: auditKey(logId) });
  return user;
};

/**
 * Sets a player's permission overrides. A moderator with this right can only
 * hand out permissions they hold themselves; admins always have everything,
 * so their overrides would mean nothing and are refused.
 */
export const setPermissionOverrides = async (userId, { grants = [], revokes = [] }, adminId) => {
  if (String(userId) === String(adminId)) throw new AdminError('You cannot change your own permissions');
  if (![...grants, ...revokes].every(isValidPermission)) throw new AdminError('Invalid permission');
  // Managing roles and permissions stays with admins and founders.
  if (!grants.every(isDelegable)) throw new AdminError('Role and permission management cannot be handed out', 400);
  const user = await User.findById(userId).select('role permissionGrants permissionRevokes');
  if (!user) return null;
  if (FULL_ACCESS_ROLES.includes(user.role)) throw new AdminError('Admins and founders always have every permission');
  const actor = await guardTarget(user, adminId, 'change the permissions of');
  if (rankOf(actor?.role) < rankOf('admin')) throw new AdminError('Only admins can change permissions', 403);
  const mine = new Set(permissionsFor(actor));
  const base = new Set(ROLE_PERMISSIONS[user.role] ?? []);

  // Only what differs from the role is stored.
  const newGrants = [...new Set(grants)].filter((p) => !base.has(p));
  const newRevokes = [...new Set(revokes)].filter((p) => base.has(p) && !newGrants.includes(p));
  const added = newGrants.filter((p) => !(user.permissionGrants ?? []).includes(p));
  if (!added.every((p) => mine.has(p))) throw new AdminError('You can only grant permissions you hold yourself', 403);
  // Any admin permission needs the door to the admin area.
  if (newGrants.length && !base.has('admin.access') && !newRevokes.includes('admin.access') && !newGrants.includes('admin.access')) {
    if (!mine.has('admin.access')) throw new AdminError('You can only grant permissions you hold yourself', 403);
    newGrants.push('admin.access');
  }

  const updated = await User.findByIdAndUpdate(userId, { $set: { permissionGrants: newGrants, permissionRevokes: newRevokes } }, { new: true }).select('-password');
  const logId = await recordAudit(adminId, 'user.permissions', {
    targetId: userId,
    details: { grants: { from: user.permissionGrants ?? [], to: newGrants }, revokes: { from: user.permissionRevokes ?? [], to: newRevokes } },
  });
  await notify(userId, { type: 'account', title: 'Your permissions changed', body: 'An admin updated what you can do in the admin area.', link: '/admin', dedupeKey: auditKey(logId) });
  return updated;
};

const PROFILE_FIELDS = Object.freeze({ displayName: '', bio: '', avatar: '' });

/** Clears offensive profile fields (they fall back to the username / default avatar). */
export const moderateProfile = async (userId, fields, reason, adminId) => {
  const why = cleanReason(reason);
  if (!why) throw new AdminError('A reason is required');
  if (!Array.isArray(fields) || !fields.length || !fields.every((f) => f in PROFILE_FIELDS)) throw new AdminError('Invalid profile fields');
  if (String(userId) === String(adminId)) throw new AdminError('Use your profile to change your own details');
  const user = await User.findById(userId).select('role');
  if (!user) return null;
  await guardTarget(user, adminId, 'moderate');
  const updated = await User.findByIdAndUpdate(userId, { $set: Object.fromEntries(fields.map((f) => [f, PROFILE_FIELDS[f]])) }, { new: true }).select('-password');
  const logId = await recordAudit(adminId, 'user.profile-reset', { targetId: userId, reason: why, details: { fields } });
  await notify(userId, { type: 'account', title: 'A moderator reset part of your profile', body: `${fields.join(', ')}: ${why}`, link: '/profile', dedupeKey: auditKey(logId) });
  return updated;
};

/**
 * Gives a player XP. Admins and founders only (users.xp can't be delegated),
 * never to yourself, with a reason; recorded in the audit log and told to the
 * player. The level it leads to comes from the same curve as earned XP.
 *
 * @returns {Promise<{ before: object, after: object }|null>} null when the player does not exist
 */
export const grantXp = async (userId, amount, reason, adminId) => {
  const points = amount;
  if (typeof points !== 'number' || !Number.isInteger(points) || points < 1 || points > XP_GRANT_MAX) {
    throw new AdminError(`XP must be a whole number from 1 to ${XP_GRANT_MAX.toLocaleString('en-US')}`);
  }
  const why = cleanReason(reason);
  if (!why) throw new AdminError('A reason is required');
  if (String(userId) === String(adminId)) throw new AdminError('You cannot grant XP to yourself');
  const actor = await User.findById(adminId).select('role');
  if (rankOf(actor?.role) < rankOf('admin')) throw new AdminError('Only admins can grant XP', 403);
  const target = await User.findById(userId).select('role status');
  if (!target) return null;
  if (target.status !== 'active') throw new AdminError('That account is not active');

  const levels = await awardXp(userId, points);
  if (!levels) throw new AdminError('Could not grant XP', 500);
  const logId = await recordAudit(adminId, 'user.xp', { targetId: userId, reason: why, details: { amount: points, level: { from: levels.before.level, to: levels.after.level } } });
  await notify(userId, { type: 'account', title: `A staff member granted you ${points.toLocaleString('en-US')} XP`, body: why, link: '/profile', dedupeKey: auditKey(logId) });
  return levels;
};

export const PERMISSION_CATALOG = Object.entries(PERMISSIONS).map(([id, description]) => ({ id, description }));

/**
 * Gets admin dashboard stats
 */
export const getDashboardStats = async () => {
  const [
    totalUsers,
    activeUsers,
    deactivatedUsers,
    bannedUsers,
    usersByRole,
    recentUsers,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ status: 'active' }),
    User.countDocuments({ status: 'deactivated' }),
    User.countDocuments({ status: 'banned' }),
    User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]),
    User.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('username email createdAt status'),
  ]);

  return {
    totalUsers,
    activeUsers,
    deactivatedUsers,
    bannedUsers,
    usersByRole: usersByRole.reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {}),
    recentUsers,
  };
};
