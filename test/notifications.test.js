import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../src/models/user.model.js';
import Notification from '../src/models/notification.model.js';
import DailyAttempt from '../src/models/daily-attempt.model.js';
import { gameEvents } from '../src/events/game-events.js';
import { CATEGORY_OF, isMuted, notify, toPublic } from '../src/services/notification.service.js';
import { DAILY_REMINDER_HOURS, reminderHoursLeft } from '../src/services/notification-scheduler.js';
import {
  CATCHUP_MIN_INTERVAL_MS,
  CATCHUP_WINDOW_DAYS,
  catchUpNotifications,
  lookbackStart,
  noticeForAudit,
} from '../src/services/notification-catchup.js';
import { NON_DELEGABLE, PERMISSIONS, PERMISSION_IDS, ROLES, ROLE_PERMISSIONS, ROLE_RANK, hasPermission, isDelegable, permissionsFor, rankOf } from '../src/config/permissions.js';
import { requirePermission } from '../src/middleware/auth.middleware.js';

const id = () => new mongoose.Types.ObjectId();
const leanOf = (value) => ({ select() { return this; }, lean: async () => value });

describe('notification preferences', () => {
  it('only the four optional categories can be muted', () => {
    assert.equal(isMuted({ social: false }, 'follow'), true);
    assert.equal(isMuted({ daily: false }, 'daily-expiring'), true);
    assert.equal(isMuted({ daily: false }, 'follow'), false);
    assert.equal(isMuted({}, 'follow'), false, 'missing means on');
    assert.equal(isMuted({ social: false, achievements: false, races: false, daily: false }, 'account'), false, 'account notices always arrive');
  });

  it('every type has a category', () => {
    for (const type of ['follow', 'race-invite', 'achievement', 'level-up', 'race-result', 'daily-expiring', 'daily-rank', 'account']) assert.ok(CATEGORY_OF[type], type);
  });
});

describe('notify', () => {
  afterEach(() => mock.restoreAll());
  const pushes = () => {
    const seen = [];
    const on = (e) => seen.push(e);
    gameEvents.on('notification', on);
    return { seen, stop: () => gameEvents.off('notification', on) };
  };

  it('stores the notification and pushes it live', async () => {
    const userId = id();
    mock.method(User, 'findById', () => leanOf({ notificationPrefs: {} }));
    const create = mock.method(Notification, 'create', async () => ({}));
    const p = pushes();
    const made = await notify(userId, { type: 'follow', title: 'Ana followed you' });
    p.stop();
    assert.equal(create.mock.callCount(), 1);
    assert.equal(p.seen.length, 1);
    assert.equal(p.seen[0].userId, String(userId));
    assert.equal(p.seen[0].notification.title, 'Ana followed you');
    assert.equal(made.title, 'Ana followed you');
  });

  it('is silent for a muted category', async () => {
    mock.method(User, 'findById', () => leanOf({ notificationPrefs: { social: false } }));
    const create = mock.method(Notification, 'create', async () => ({}));
    assert.equal(await notify(id(), { type: 'follow', title: 'x' }), null);
    assert.equal(create.mock.callCount(), 0);
  });

  it('with a dedupe key, the same event notifies once', async () => {
    mock.method(User, 'findById', () => leanOf({ notificationPrefs: {} }));
    let first = true;
    mock.method(Notification, 'updateOne', async () => {
      const upsertedCount = first ? 1 : 0;
      first = false;
      return { upsertedCount };
    });
    const p = pushes();
    assert.ok(await notify(id(), { type: 'race-result', title: 'x', dedupeKey: 'race:1' }));
    assert.equal(await notify(id(), { type: 'race-result', title: 'x', dedupeKey: 'race:1' }), null);
    p.stop();
    assert.equal(p.seen.length, 1);
  });

  it('a caught-up notice is stored with the event time and not pushed as a live toast', async () => {
    mock.method(User, 'findById', () => leanOf({ notificationPrefs: {} }));
    const create = mock.method(Notification, 'create', async () => ({}));
    const p = pushes();
    const at = new Date('2026-01-01T00:00:00Z');
    await notify(id(), { type: 'follow', title: 'x', createdAt: at, live: false });
    p.stop();
    assert.equal(p.seen.length, 0);
    assert.equal(create.mock.calls[0].arguments[0].createdAt, at);
  });

  it('never throws: a failing database just means no notification', async () => {
    mock.method(User, 'findById', () => { throw new Error('db down'); });
    mock.method(console, 'error', () => {});
    assert.equal(await notify(id(), { type: 'follow', title: 'x' }), null);
  });

  it('rejects an unknown type without storing anything', async () => {
    const create = mock.method(Notification, 'create', async () => ({}));
    mock.method(console, 'error', () => {});
    assert.equal(await notify(id(), { type: 'made-up', title: 'x' }), null);
    assert.equal(create.mock.callCount(), 0);
  });

  it('has a public shape without internals', () => {
    const shown = toPublic({ _id: id(), type: 'follow', title: 't', body: '', link: '/x', readAt: null, createdAt: new Date(0), userId: id(), dedupeKey: 'k' });
    assert.deepEqual(Object.keys(shown).sort(), ['body', 'createdAt', 'id', 'link', 'read', 'title', 'type']);
    assert.equal(shown.read, false);
  });
});

describe('daily reminder timing', () => {
  it('starts reminding in the last DAILY_REMINDER_HOURS of the UTC day', () => {
    assert.equal(reminderHoursLeft(new Date('2026-10-28T20:59:00Z')), null, 'just over 3h left');
    assert.equal(reminderHoursLeft(new Date('2026-10-28T21:00:00Z')), DAILY_REMINDER_HOURS, 'exactly 3h left');
    assert.equal(reminderHoursLeft(new Date('2026-10-28T22:30:00Z')), 2);
    assert.equal(reminderHoursLeft(new Date('2026-10-28T23:30:00Z')), 1);
    assert.equal(reminderHoursLeft(new Date('2026-10-29T00:00:00Z')), null, 'a new day has just begun');
  });
});

describe('catch-up', () => {
  afterEach(() => mock.restoreAll());
  const NOW = new Date('2026-10-28T10:00:00Z');

  it('looks back over the window the first time, then from the last run with some overlap', () => {
    assert.equal(lookbackStart(null, NOW).toISOString(), new Date(NOW.getTime() - CATCHUP_WINDOW_DAYS * 86_400_000).toISOString());
    const last = new Date('2026-10-28T09:00:00Z');
    assert.equal(lookbackStart(last, NOW).toISOString(), '2026-10-28T08:00:00.000Z');
  });

  it('never looks back further than the window, however long ago the last run was', () => {
    assert.equal(lookbackStart(new Date('2025-01-01T00:00:00Z'), NOW).toISOString(), new Date(NOW.getTime() - CATCHUP_WINDOW_DAYS * 86_400_000).toISOString());
  });

  it('does nothing when it ran a moment ago', async () => {
    const find = mock.method(User, 'findById', () => leanOf({ status: 'active', notificationsSyncedAt: new Date(NOW.getTime() - CATCHUP_MIN_INTERVAL_MS + 1000) }));
    assert.equal(await catchUpNotifications(id(), NOW), 0);
    assert.equal(find.mock.callCount(), 1, 'only the throttle check');
  });

  it('does nothing for an account that is not active', async () => {
    mock.method(User, 'findById', () => leanOf({ status: 'banned' }));
    assert.equal(await catchUpNotifications(id(), NOW), 0);
  });

  it('turns an audit entry into the notice the player should have had', () => {
    assert.equal(noticeForAudit({ action: 'user.warn', reason: 'spam' }).body, 'spam');
    assert.equal(noticeForAudit({ action: 'user.role', details: { to: 'moderator' } }).title, 'Your role is now moderator');
    assert.equal(noticeForAudit({ action: 'user.ban', reason: 'cheating' }).title, 'Your account was banned');
    assert.equal(noticeForAudit({ action: 'race.kick' }), null, 'live-only actions are not caught up');
  });

  it('tells a player about an expiring daily they have not played, once', async () => {
    const late = new Date('2026-10-28T22:00:00Z');
    mock.method(User, 'findById', () => leanOf({ status: 'active', notificationsSyncedAt: null, notificationPrefs: {} }));
    mock.method(User, 'updateOne', async () => ({}));
    // Every other source is empty.
    const empty = { sort() { return this; }, limit() { return this; }, populate() { return this; }, select() { return this; }, lean: async () => [] };
    for (const [model, method] of await sources()) mock.method(model, method, () => empty);
    mock.method(DailyAttempt, 'exists', async () => null);
    const stored = [];
    mock.method(Notification, 'updateOne', async (filter, update) => {
      stored.push({ filter, doc: update.$setOnInsert });
      return { upsertedCount: 1 };
    });
    assert.equal(await catchUpNotifications(id(), late), 1);
    assert.equal(stored[0].filter.dedupeKey, 'daily-expiring:2026-10-28');
    assert.equal(stored[0].doc.type, 'daily-expiring');
  });

  it('does not nag someone who already started the daily', async () => {
    const late = new Date('2026-10-28T22:00:00Z');
    mock.method(User, 'findById', () => leanOf({ status: 'active', notificationsSyncedAt: null, notificationPrefs: {} }));
    mock.method(User, 'updateOne', async () => ({}));
    const empty = { sort() { return this; }, limit() { return this; }, populate() { return this; }, select() { return this; }, lean: async () => [] };
    for (const [model, method] of await sources()) mock.method(model, method, () => empty);
    mock.method(DailyAttempt, 'exists', async () => ({ _id: 1 }));
    const upsert = mock.method(Notification, 'updateOne', async () => ({ upsertedCount: 1 }));
    assert.equal(await catchUpNotifications(id(), late), 0);
    assert.equal(upsert.mock.callCount(), 0);
  });
});

async function sources() {
  const [{ default: Follow }, { default: Race }, { default: AuditLog }, { default: UserAchievement }] = await Promise.all([
    import('../src/models/follow.model.js'),
    import('../src/models/race.model.js'),
    import('../src/models/audit-log.model.js'),
    import('../src/models/user-achievement.model.js'),
  ]);
  return [[Follow, 'find'], [Race, 'find'], [AuditLog, 'find'], [UserAchievement, 'find'], [DailyAttempt, 'find']];
}

describe('permissions', () => {
  const user = (over = {}) => ({ role: 'user', permissionGrants: [], permissionRevokes: [], ...over });

  it('a player has none, a moderator the moderation set, an admin everything', () => {
    assert.deepEqual(permissionsFor(user()), []);
    assert.deepEqual(permissionsFor(user({ role: 'moderator' })).sort(), [...ROLE_PERMISSIONS.moderator].sort());
    assert.deepEqual(permissionsFor(user({ role: 'admin' })), PERMISSION_IDS);
  });

  it('a moderator cannot, by default, change roles, grant permissions, delete or read the audit log', () => {
    const mod = user({ role: 'moderator' });
    for (const p of ['users.role', 'users.permissions', 'users.delete', 'audit.view']) assert.equal(hasPermission(mod, p), false, p);
    for (const p of ['users.view', 'users.moderate', 'content.moderate', 'race.moderate']) assert.equal(hasPermission(mod, p), true, p);
  });

  it('per-user grants add and revokes remove', () => {
    assert.equal(hasPermission(user({ role: 'moderator', permissionGrants: ['audit.view'] }), 'audit.view'), true);
    assert.equal(hasPermission(user({ role: 'moderator', permissionRevokes: ['users.moderate'] }), 'users.moderate'), false);
    assert.equal(hasPermission(user({ permissionGrants: ['users.view', 'admin.access'] }), 'users.view'), true, 'a player can be given single permissions');
  });

  it('a revoke wins over the role, and unknown permissions are ignored', () => {
    assert.equal(hasPermission(user({ role: 'moderator', permissionGrants: ['users.moderate'], permissionRevokes: ['users.moderate'] }), 'users.moderate'), false);
    assert.deepEqual(permissionsFor(user({ permissionGrants: ['made.up'] })), []);
  });

  it('admins cannot be stripped of anything by overrides', () => {
    assert.deepEqual(permissionsFor(user({ role: 'admin', permissionRevokes: ['users.role'] })), PERMISSION_IDS);
  });

  it('role and permission management belongs to admins and founders only, whatever a grant says', () => {
    const delegate = user({ role: 'moderator', permissionGrants: ['users.role', 'users.permissions', 'audit.view'] });
    for (const p of NON_DELEGABLE) assert.equal(hasPermission(delegate, p), false, p);
    assert.equal(hasPermission(delegate, 'audit.view'), true, 'other grants still work');
    assert.equal(hasPermission(user({ permissionGrants: ['users.role', 'admin.access'] }), 'users.role'), false);
    for (const role of ['admin', 'founder']) for (const p of NON_DELEGABLE) assert.equal(hasPermission(user({ role }), p), true, `${role} ${p}`);
    assert.deepEqual(NON_DELEGABLE.filter(isDelegable), []);
  });

  it('a founder holds everything, overrides included', () => {
    assert.deepEqual(permissionsFor(user({ role: 'founder', permissionRevokes: ['users.delete'] })), PERMISSION_IDS);
  });

  it('ranks the roles from player up to founder', () => {
    assert.deepEqual(ROLES, ['user', 'moderator', 'admin', 'founder']);
    assert.ok(ROLE_RANK.user < ROLE_RANK.moderator && ROLE_RANK.moderator < ROLE_RANK.admin && ROLE_RANK.admin < ROLE_RANK.founder);
    assert.equal(rankOf('nonsense'), 0);
  });

  it('knows nothing about nobody', () => {
    assert.deepEqual(permissionsFor(null), []);
    assert.equal(hasPermission(undefined, 'users.view'), false);
  });

  it('every role permission exists in the catalog', () => {
    for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) assert.ok(PERMISSIONS[p], p);
  });
});

describe('requirePermission', () => {
  const run = (user, ...perms) => {
    let status = null;
    let nexted = false;
    const res = { status(s) { status = s; return this; }, json() {} };
    requirePermission(...perms)({ user }, res, () => { nexted = true; });
    return { status, nexted };
  };

  it('lets through a user holding every listed permission', () => {
    assert.deepEqual(run({ role: 'moderator' }, 'admin.access', 'users.moderate'), { status: null, nexted: true });
  });

  it('refuses when any one is missing', () => {
    assert.deepEqual(run({ role: 'moderator' }, 'admin.access', 'users.role'), { status: 403, nexted: false });
  });

  it('refuses a player outright, and an absent user as unauthenticated', () => {
    assert.equal(run({ role: 'user' }, 'admin.access').status, 403);
    assert.equal(run(undefined, 'admin.access').status, 401);
  });

  it('honours a per-user revoke of admin.access', () => {
    assert.equal(run({ role: 'moderator', permissionRevokes: ['admin.access'] }, 'admin.access').status, 403);
  });
});

describe('user documents', () => {
  it('say what the user may do whenever they are sent to a client', () => {
    const mod = new User({ username: 'mod_one', email: 'm@example.com', password: 'x', role: 'moderator', permissionGrants: ['audit.view'] });
    const json = mod.toJSON();
    assert.ok(json.permissions.includes('audit.view') && json.permissions.includes('users.moderate'));
    assert.deepEqual(new User({ username: 'plain_one', email: 'p@example.com', password: 'x' }).toJSON().permissions, []);
  });
});
