import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../src/models/user.model.js';
import AuditLog from '../src/models/audit-log.model.js';
import Notification from '../src/models/notification.model.js';
import { AdminError, deleteUser, moderateProfile, setPermissionOverrides, updateUserRole, updateUserStatus, warnUser } from '../src/services/admin.service.js';
import { applyConfiguredRoles } from '../src/services/bootstrap-roles.js';

const id = () => new mongoose.Types.ObjectId();

/** A query result that can be awaited directly or finished with .select()/.lean(). */
const result = (value) => {
  const q = Promise.resolve(value);
  q.select = () => q;
  q.lean = async () => value;
  return q;
};

/** Users by id: `findById` answers from this table. */
const users = (table) => mock.method(User, 'findById', (userId) => result(table[String(userId)] ?? null));

const quiet = () => {
  const audit = mock.method(AuditLog, 'create', async (doc) => ({ _id: id(), ...doc }));
  mock.method(Notification, 'create', async () => ({}));
  mock.method(Notification, 'updateOne', async () => ({ upsertedCount: 1 }));
  return audit;
};

const rejectsWith = (promise, status, pattern) =>
  assert.rejects(promise, (err) => err instanceof AdminError && err.status === status && pattern.test(err.message));

const [founder, admin, otherAdmin, mod, otherMod, player] = [id(), id(), id(), id(), id(), id()];
const table = () => ({
  [founder]: { role: 'founder' },
  [admin]: { role: 'admin' },
  [otherAdmin]: { role: 'admin' },
  [mod]: { role: 'moderator', permissionGrants: [], permissionRevokes: [] },
  [otherMod]: { role: 'moderator', permissionGrants: [], permissionRevokes: [] },
  [player]: { role: 'user', permissionGrants: [], permissionRevokes: [] },
});

describe('role changes', () => {
  afterEach(() => mock.restoreAll());

  it('an admin can make a moderator, and the change is audited with before and after', async () => {
    users(table());
    const audit = quiet();
    mock.method(User, 'findByIdAndUpdate', () => result({ role: 'moderator' }));
    await updateUserRole(String(player), 'moderator', admin);
    const entry = audit.mock.calls[0].arguments[0];
    assert.equal(entry.action, 'user.role');
    assert.deepEqual(entry.details, { from: 'user', to: 'moderator' });
  });

  it('moderators cannot change roles at all', async () => {
    users(table());
    quiet();
    mock.method(User, 'findByIdAndUpdate', () => result({}));
    await rejectsWith(updateUserRole(String(player), 'moderator', mod), 403, /Only admins/);
    await rejectsWith(updateUserRole(String(player), 'user', mod), 403, /Only admins/);
  });

  it('even a moderator granted role management cannot: it is not delegable', async () => {
    const delegate = id();
    users({ ...table(), [delegate]: { role: 'moderator', permissionGrants: ['users.role'], permissionRevokes: [] } });
    quiet();
    mock.method(User, 'findByIdAndUpdate', () => result({}));
    await rejectsWith(updateUserRole(String(player), 'moderator', delegate), 403, /Only admins/);
  });

  it('an admin cannot make an admin; a founder can', async () => {
    users(table());
    quiet();
    mock.method(User, 'findByIdAndUpdate', () => result({}));
    await rejectsWith(updateUserRole(String(player), 'admin', admin), 403, /below your own/);
    await updateUserRole(String(player), 'admin', founder);
  });

  it('an admin cannot change another admin, but a founder can', async () => {
    users(table());
    quiet();
    mock.method(User, 'findByIdAndUpdate', () => result({}));
    await rejectsWith(updateUserRole(String(otherAdmin), 'user', admin), 403, /lower rank/);
    await updateUserRole(String(otherAdmin), 'moderator', founder);
  });

  it('nobody can make a founder, or change one, through the app', async () => {
    users(table());
    quiet();
    mock.method(User, 'findByIdAndUpdate', () => result({}));
    await rejectsWith(updateUserRole(String(player), 'founder', founder), 400, /server settings/);
    await rejectsWith(updateUserRole(String(founder), 'user', admin), 403, /server settings/);
    await assert.rejects(updateUserRole(String(founder), 'user', founder), /own role/);
  });

  it('rejects an unknown role and your own role', async () => {
    users(table());
    await assert.rejects(updateUserRole(String(player), 'owner', admin), /Invalid role/);
    await assert.rejects(updateUserRole(String(admin), 'user', admin), /own role/);
  });
});

describe('acting on players by rank', () => {
  afterEach(() => mock.restoreAll());

  it('a moderator can warn and ban a player but not another moderator, an admin or a founder', async () => {
    users(table());
    quiet();
    mock.method(User, 'findByIdAndUpdate', () => result({}));
    await warnUser(player, 'Please keep chat civil', mod);
    await updateUserStatus(String(player), 'banned', 'cheating', mod);
    for (const target of [otherMod, admin, founder]) {
      await assert.rejects(warnUser(target, 'x', mod), AdminError);
      await assert.rejects(updateUserStatus(String(target), 'banned', 'x', mod), AdminError);
    }
  });

  it('an admin can act on moderators but not on admins; a founder can act on admins', async () => {
    users(table());
    quiet();
    mock.method(User, 'findByIdAndUpdate', () => result({}));
    await updateUserStatus(String(mod), 'deactivated', 'inactive', admin);
    await rejectsWith(updateUserStatus(String(otherAdmin), 'banned', 'x', admin), 403, /lower rank/);
    await updateUserStatus(String(otherAdmin), 'banned', 'misconduct', founder);
  });

  it('a founder is untouchable, even by another founder', async () => {
    const other = id();
    users({ ...table(), [other]: { role: 'founder' } });
    quiet();
    await rejectsWith(updateUserStatus(String(founder), 'banned', 'x', other), 403, /server settings/);
    await rejectsWith(warnUser(founder, 'x', other), 403, /server settings/);
  });

  it('deleting follows the same rank rule', async () => {
    users(table());
    quiet();
    await rejectsWith(deleteUser(String(otherAdmin), admin), 403, /lower rank/);
    await rejectsWith(deleteUser(String(founder), admin), 403, /server settings/);
  });

  it('a warning needs a reason', async () => {
    users(table());
    quiet();
    await rejectsWith(warnUser(player, '   ', mod), 400, /reason is required/);
  });

  it('profile resets name fields, need a reason, and respect rank', async () => {
    users(table());
    quiet();
    const update = mock.method(User, 'findByIdAndUpdate', () => result({}));
    await moderateProfile(player, ['bio', 'avatar'], 'offensive', mod);
    assert.deepEqual(update.mock.calls[0].arguments[1].$set, { bio: '', avatar: '' });
    await rejectsWith(moderateProfile(player, ['email'], 'x', mod), 400, /Invalid profile fields/);
    await rejectsWith(moderateProfile(player, ['bio'], '', mod), 400, /reason is required/);
    await rejectsWith(moderateProfile(admin, ['bio'], 'x', mod), 403, /lower rank/);
  });
});

describe('permission overrides', () => {
  afterEach(() => mock.restoreAll());

  it('an admin can grant a permission to a moderator, and it is audited', async () => {
    users(table());
    const audit = quiet();
    const update = mock.method(User, 'findByIdAndUpdate', () => result({ role: 'moderator' }));
    await setPermissionOverrides(mod, { grants: ['audit.view'], revokes: [] }, admin);
    assert.deepEqual(update.mock.calls[0].arguments[1].$set, { permissionGrants: ['audit.view'], permissionRevokes: [] });
    assert.equal(audit.mock.calls[0].arguments[0].action, 'user.permissions');
  });

  it('role and permission management can never be handed out, even by a founder', async () => {
    users(table());
    quiet();
    await rejectsWith(setPermissionOverrides(mod, { grants: ['users.role'] }, founder), 400, /cannot be handed out/);
    await rejectsWith(setPermissionOverrides(mod, { grants: ['users.permissions'] }, admin), 400, /cannot be handed out/);
  });

  it('moderators cannot change anyone\'s permissions', async () => {
    users(table());
    quiet();
    await rejectsWith(setPermissionOverrides(player, { grants: ['users.view'] }, mod), 403, /Only admins/);
  });

  it('granting a player anything also opens the admin area to them', async () => {
    users(table());
    quiet();
    const update = mock.method(User, 'findByIdAndUpdate', () => result({}));
    await setPermissionOverrides(player, { grants: ['users.view'], revokes: [] }, admin);
    assert.deepEqual(update.mock.calls[0].arguments[1].$set.permissionGrants.sort(), ['admin.access', 'users.view']);
  });

  it('only stores what differs from the role', async () => {
    users(table());
    quiet();
    const update = mock.method(User, 'findByIdAndUpdate', () => result({}));
    // users.view is already the role's (a grant adds nothing); audit.view is not (a revoke of it removes nothing).
    await setPermissionOverrides(mod, { grants: ['audit.view', 'users.view'], revokes: ['race.moderate', 'audit.view'] }, admin);
    assert.deepEqual(update.mock.calls[0].arguments[1].$set, { permissionGrants: ['audit.view'], permissionRevokes: ['race.moderate'] });
  });

  it('refuses your own permissions, admins and founders, and unknown permissions', async () => {
    users(table());
    quiet();
    await rejectsWith(setPermissionOverrides(admin, { grants: [] }, admin), 400, /your own/);
    await rejectsWith(setPermissionOverrides(otherAdmin, { grants: [] }, founder), 400, /always have every permission/);
    await rejectsWith(setPermissionOverrides(mod, { grants: ['root'] }, admin), 400, /Invalid permission/);
  });

  it('answers null for a player that does not exist', async () => {
    users(table());
    assert.equal(await setPermissionOverrides(id(), { grants: [] }, admin), null);
  });
});

describe('roles from the server settings', () => {
  afterEach(() => mock.restoreAll());

  const connected = () => {
    const original = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
    Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
    return () => (original ? Object.defineProperty(mongoose.connection, 'readyState', original) : delete mongoose.connection.readyState);
  };

  /** User.find(...).collation().select().limit().lean() answering by name. */
  const accounts = (byName) =>
    mock.method(User, 'find', (filter) => {
      const rows = byName[filter.username] ?? [];
      const q = { collation: () => q, select: () => q, limit: () => q, lean: async () => rows };
      return q;
    });
  const none = { founderIds: [], founders: [], adminIds: [], admins: [] };

  it('promotes an account by id exactly, and reports how many', async () => {
    const restore = connected();
    const target = id();
    const update = mock.method(User, 'updateMany', async () => ({ modifiedCount: 1 }));
    mock.method(console, 'log', () => {});
    const out = await applyConfiguredRoles({ ...none, founderIds: [String(target)] });
    restore();
    assert.deepEqual(out, { founders: 1, admins: 0 });
    assert.deepEqual(update.mock.calls[0].arguments[0]._id, { $in: [String(target)] });
    assert.deepEqual(update.mock.calls[0].arguments[1], { $set: { role: 'founder' } });
  });

  it('resolves a username ignoring case, to the one account it matches', async () => {
    const restore = connected();
    const boss = id();
    accounts({ Boss: [{ _id: boss }] });
    const update = mock.method(User, 'updateMany', async () => ({ modifiedCount: 1 }));
    mock.method(console, 'log', () => {});
    await applyConfiguredRoles({ ...none, founders: ['Boss'] });
    restore();
    assert.deepEqual(update.mock.calls[0].arguments[0]._id, { $in: [String(boss)] });
  });

  it('refuses a username that matches more than one account, and says so', async () => {
    const restore = connected();
    accounts({ Boss: [{ _id: id() }, { _id: id() }] });
    const update = mock.method(User, 'updateMany', async () => ({ modifiedCount: 1 }));
    const logged = mock.method(console, 'error', () => {});
    const out = await applyConfiguredRoles({ ...none, founders: ['Boss'], admins: ['Boss'] });
    restore();
    assert.deepEqual(out, { founders: 0, admins: 0 });
    assert.equal(update.mock.callCount(), 0, 'nobody is promoted on a guess');
    assert.match(logged.mock.calls[0].arguments[0], /REFUSED founder "Boss"/);
  });

  it('only ever promotes admins: it never demotes, and never touches a founder or a banned account', async () => {
    const restore = connected();
    const filters = [];
    mock.method(User, 'updateMany', async (filter) => {
      filters.push(filter);
      return { modifiedCount: 0 };
    });
    await applyConfiguredRoles({ ...none, adminIds: [String(id())] });
    restore();
    assert.deepEqual(filters[0].role, { $in: ['user', 'moderator'] });
    assert.equal(filters[0].status, 'active');
  });

  it('does nothing when nothing is configured, or without a database', async () => {
    const update = mock.method(User, 'updateMany', async () => ({ modifiedCount: 0 }));
    assert.deepEqual(await applyConfiguredRoles({ ...none, founderIds: [String(id())] }), { founders: 0, admins: 0 });
    const restore = connected();
    await applyConfiguredRoles(none);
    restore();
    assert.equal(update.mock.callCount(), 0);
  });
});
