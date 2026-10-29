/**
 * Roles, ranks and permissions.
 *
 * Roles carry a fixed set of permissions (ROLE_PERMISSIONS); an admin can then
 * grant or revoke single permissions on one user (User.permissionGrants /
 * permissionRevokes). Routes check permissions, never role names.
 *
 * Roles are also ranked. You can only act on someone of lower rank, and you
 * can only give a role below your own. The top rank, founder, is never
 * assigned through the app: it comes only from the FOUNDER_USERNAMES setting
 * (config/env.js), and nobody can act on a founder.
 */

export const PERMISSIONS = Object.freeze({
  'admin.access': 'Open the admin area',
  'users.view': 'See the user list and profiles',
  'users.moderate': 'Warn, deactivate, ban and reactivate players',
  'users.role': 'Change a player\'s role',
  'users.permissions': 'Grant or revoke single permissions',
  'users.delete': 'Delete accounts',
  'content.moderate': 'Reset offensive display names, bios and avatars',
  'race.moderate': 'Mute players and remove them from race rooms',
  'audit.view': 'Read the audit log',
});

export const PERMISSION_IDS = Object.freeze(Object.keys(PERMISSIONS));

/** Managing roles and permissions is for admins and founders only: it can't be delegated to anyone else. */
export const NON_DELEGABLE = Object.freeze(['users.role', 'users.permissions']);

export const ROLES = Object.freeze(['user', 'moderator', 'admin', 'founder']);

/** Higher outranks lower. */
export const ROLE_RANK = Object.freeze({ user: 0, moderator: 1, admin: 2, founder: 3 });
export const rankOf = (role) => ROLE_RANK[role] ?? 0;

/** Roles that hold every permission, whatever overrides say. */
export const FULL_ACCESS_ROLES = Object.freeze(['admin', 'founder']);

export const ROLE_PERMISSIONS = Object.freeze({
  user: Object.freeze([]),
  moderator: Object.freeze(['admin.access', 'users.view', 'users.moderate', 'content.moderate', 'race.moderate']),
  // Overrides don't apply to these, so nobody can lock the last admin out by accident.
  admin: PERMISSION_IDS,
  founder: PERMISSION_IDS,
});

/** Permissions a user holds: their role's, plus grants, minus revokes (never the non-delegable ones below admin). */
export const permissionsFor = (user) => {
  if (!user) return [];
  if (FULL_ACCESS_ROLES.includes(user.role)) return [...PERMISSION_IDS];
  const held = new Set(ROLE_PERMISSIONS[user.role] ?? []);
  for (const p of user.permissionGrants ?? []) if (PERMISSIONS[p] && !NON_DELEGABLE.includes(p)) held.add(p);
  for (const p of user.permissionRevokes ?? []) held.delete(p);
  return PERMISSION_IDS.filter((p) => held.has(p));
};

export const hasPermission = (user, permission) => permissionsFor(user).includes(permission);

export const isValidPermission = (p) => typeof p === 'string' && !!PERMISSIONS[p];

/** Whether a permission may be granted to someone below admin. */
export const isDelegable = (p) => isValidPermission(p) && !NON_DELEGABLE.includes(p);
