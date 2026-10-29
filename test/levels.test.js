import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../src/models/user.model.js';
import AuditLog from '../src/models/audit-log.model.js';
import Notification from '../src/models/notification.model.js';
import { XP_BY_RARITY, XP_DAILY_BONUS, XP_GRANT_MAX, XP_PER_RUN_MAX, levelInfo, xpForLevel, xpForRun } from '../src/config/levels.js';
import { awardXp } from '../src/services/xp.service.js';
import { AdminError, grantXp } from '../src/services/admin.service.js';
import { staffRole } from '../src/utils/public-identity.js';
import { ACHIEVEMENTS } from '../src/config/achievements.js';
import { NON_DELEGABLE, hasPermission, permissionsFor } from '../src/config/permissions.js';

const id = () => new mongoose.Types.ObjectId();
const result = (value) => {
  const q = Promise.resolve(value);
  q.select = () => q;
  q.lean = async () => value;
  return q;
};

describe('level curve', () => {
  it('reaching a level takes 50 * L * (L + 1) XP in total', () => {
    assert.deepEqual([1, 2, 5, 10, 25, 50].map(xpForLevel), [100, 300, 1500, 5500, 32500, 127500]);
  });

  it('level changes exactly at the threshold, not one point before', () => {
    assert.equal(levelInfo(0).level, 0);
    assert.equal(levelInfo(99).level, 0);
    assert.equal(levelInfo(100).level, 1);
    assert.equal(levelInfo(299).level, 1);
    assert.equal(levelInfo(300).level, 2);
    assert.equal(levelInfo(127_499).level, 49);
    assert.equal(levelInfo(127_500).level, 50);
  });

  it('agrees with the thresholds at every level (no float drift)', () => {
    for (let level = 1; level <= 300; level++) {
      assert.equal(levelInfo(xpForLevel(level)).level, level, `at ${level}`);
      assert.equal(levelInfo(xpForLevel(level) - 1).level, level - 1, `just below ${level}`);
    }
  });

  it('reports how far into the level, what the next one needs, and the progress', () => {
    const info = levelInfo(450); // level 2 starts at 300, level 3 at 600
    assert.deepEqual([info.level, info.into, info.needed], [2, 150, 300]);
    assert.equal(info.progress, 0.5);
    assert.deepEqual([levelInfo(0).into, levelInfo(0).needed, levelInfo(0).progress], [0, 100, 0]);
  });

  it('treats junk as zero XP', () => {
    for (const bad of [undefined, null, NaN, -50, 'abc']) assert.equal(levelInfo(bad).xp, 0);
    assert.equal(levelInfo(12.9).xp, 12);
  });
});

describe('XP for a run', () => {
  it('one point per six seconds typed, up to a cap', () => {
    assert.equal(xpForRun(5), 0);
    assert.equal(xpForRun(6), 1);
    assert.equal(xpForRun(60), 10);
    assert.equal(xpForRun(300), XP_PER_RUN_MAX);
    assert.equal(xpForRun(3600), XP_PER_RUN_MAX, 'a long run cannot be farmed past the cap');
  });

  it('a daily run adds a bonus on top', () => {
    assert.equal(xpForRun(60, { daily: true }), 10 + XP_DAILY_BONUS);
    assert.equal(xpForRun(0, { daily: true }), XP_DAILY_BONUS);
  });

  it('ignores negative and junk time', () => {
    assert.equal(xpForRun(-30), 0);
    assert.equal(xpForRun(undefined), 0);
  });

  it('every badge rarity has an XP reward', () => {
    for (const rarity of new Set(ACHIEVEMENTS.map((a) => a.rarity))) assert.ok(XP_BY_RARITY[rarity] > 0, rarity);
  });
});

describe('awardXp', () => {
  afterEach(() => mock.restoreAll());

  it('adds the points and reports the levels before and after', async () => {
    const update = mock.method(User, 'findOneAndUpdate', () => result({ stats: { xp: 130 } }));
    mock.method(User, 'findById', () => result({ notificationPrefs: {} }));
    const create = mock.method(Notification, 'updateOne', async () => ({ upsertedCount: 1 }));
    const out = await awardXp(id(), 40);
    assert.deepEqual(update.mock.calls[0].arguments[1], { $inc: { 'stats.xp': 40 } });
    assert.deepEqual([out.before.level, out.after.level], [0, 1]);
    assert.equal(create.mock.callCount(), 1, 'a level-up notification');
    assert.equal(create.mock.calls[0].arguments[1].$setOnInsert.type, 'level-up');
    assert.equal(create.mock.calls[0].arguments[0].dedupeKey, 'level:1');
  });

  it('says nothing when the level does not change', async () => {
    mock.method(User, 'findOneAndUpdate', () => result({ stats: { xp: 150 } }));
    const note = mock.method(Notification, 'updateOne', async () => ({ upsertedCount: 1 }));
    const out = await awardXp(id(), 20);
    assert.deepEqual([out.before.level, out.after.level], [1, 1]);
    assert.equal(note.mock.callCount(), 0);
  });

  it('ignores zero, negative and junk amounts without touching the database', async () => {
    const update = mock.method(User, 'findOneAndUpdate', () => result({ stats: { xp: 1 } }));
    for (const bad of [0, -5, NaN, undefined, 'x']) assert.equal(await awardXp(id(), bad), null);
    assert.equal(update.mock.callCount(), 0);
  });

  it('only awards active accounts, and never throws', async () => {
    const find = mock.method(User, 'findOneAndUpdate', () => result(null));
    assert.equal(await awardXp(id(), 10), null);
    assert.equal(find.mock.calls[0].arguments[0].status, 'active');
    mock.method(User, 'findOneAndUpdate', () => { throw new Error('db down'); });
    mock.method(console, 'error', () => {});
    assert.equal(await awardXp(id(), 10), null);
  });
});

describe('granting XP', () => {
  afterEach(() => mock.restoreAll());
  const [founder, admin, mod, player] = [id(), id(), id(), id()];
  const table = () => ({
    [founder]: { role: 'founder' },
    [admin]: { role: 'admin' },
    [mod]: { role: 'moderator' },
    [player]: { role: 'user', status: 'active' },
  });
  const setup = () => {
    const rows = table();
    mock.method(User, 'findById', (userId) => result(rows[String(userId)] ?? null));
    mock.method(User, 'findOneAndUpdate', () => result({ stats: { xp: 350 } }));
    const audit = mock.method(AuditLog, 'create', async (doc) => ({ _id: id(), ...doc }));
    mock.method(Notification, 'updateOne', async () => ({ upsertedCount: 1 }));
    mock.method(Notification, 'create', async () => ({}));
    return audit;
  };
  const rejectsWith = (promise, status, pattern) => assert.rejects(promise, (e) => e instanceof AdminError && e.status === status && pattern.test(e.message));

  it('an admin can grant XP, audited with the amount, reason and level change', async () => {
    const audit = setup();
    const out = await grantXp(player, 350, 'Event winner', admin);
    assert.equal(out.after.level, 2);
    const entry = audit.mock.calls[0].arguments[0];
    assert.equal(entry.action, 'user.xp');
    assert.equal(entry.reason, 'Event winner');
    assert.deepEqual(entry.details, { amount: 350, level: { from: 0, to: 2 } });
  });

  it('so can a founder', async () => {
    setup();
    assert.ok(await grantXp(player, 10, 'thanks', founder));
  });

  it('moderators cannot, and it cannot be delegated', async () => {
    setup();
    await rejectsWith(grantXp(player, 10, 'x', mod), 403, /Only admins/);
    assert.ok(NON_DELEGABLE.includes('users.xp'));
    assert.equal(hasPermission({ role: 'moderator', permissionGrants: ['users.xp'] }, 'users.xp'), false);
    assert.equal(hasPermission({ role: 'admin' }, 'users.xp'), true);
    assert.equal(permissionsFor({ role: 'moderator' }).includes('users.xp'), false);
  });

  it('never to yourself, and always with a reason', async () => {
    setup();
    await rejectsWith(grantXp(admin, 10, 'x', admin), 400, /yourself/);
    await rejectsWith(grantXp(player, 10, '  ', admin), 400, /reason is required/);
  });

  it('the amount is a whole number from 1 up to the cap', async () => {
    setup();
    for (const bad of [0, -1, 1.5, '12', NaN, XP_GRANT_MAX + 1]) await rejectsWith(grantXp(player, bad, 'x', admin), 400, /whole number/);
    assert.ok(await grantXp(player, XP_GRANT_MAX, 'max', admin));
  });

  it('answers null for a player that does not exist', async () => {
    setup();
    assert.equal(await grantXp(id(), 10, 'x', admin), null);
  });
});

describe('what others can see of a role', () => {
  it('shows staff roles only, never that someone is a plain player', () => {
    assert.equal(staffRole({ role: 'moderator' }), 'moderator');
    assert.equal(staffRole({ role: 'admin' }), 'admin');
    assert.equal(staffRole({ role: 'founder' }), 'founder');
    assert.equal(staffRole({ role: 'user' }), undefined);
    assert.equal(staffRole({}), undefined);
    assert.equal(staffRole(null), undefined);
  });
});

describe('user documents', () => {
  it('carry the level whenever they are sent to the client', () => {
    const u = new User({ username: 'lvl_one', email: 'l@example.com', password: 'x', stats: { xp: 450 } });
    const json = u.toJSON();
    assert.deepEqual([json.level.level, json.level.into, json.level.needed], [2, 150, 300]);
  });
});
