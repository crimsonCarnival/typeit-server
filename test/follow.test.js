import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Follow from '../src/models/follow.model.js';
import User from '../src/models/user.model.js';
import Notification from '../src/models/notification.model.js';
import { areMutual, deleteFollowsOf, followUser, getMutualIds, unfollowUser } from '../src/services/follow.service.js';

const id = () => new mongoose.Types.ObjectId();
const leanOf = (value) => ({ select() { return this; }, lean: async () => value });

describe('follow service', () => {
  afterEach(() => mock.restoreAll());

  it('creates one edge and bumps both counters', async () => {
    const [a, b] = [id(), id()];
    mock.method(User, 'exists', async () => ({ _id: b }));
    const create = mock.method(Follow, 'create', async () => ({}));
    const inc = mock.method(User, 'updateOne', async () => ({}));
    mock.method(User, 'findById', (uid) => leanOf(String(uid) === String(b) ? { followersCount: 1 } : { followingCount: 1 }));
    mock.method(Follow, 'exists', async () => null);
    mock.method(Notification, 'updateOne', async () => ({ upsertedCount: 0 }));

    const out = await followUser(a, b);
    assert.deepEqual(create.mock.calls[0].arguments[0], { follower: a, followee: b });
    assert.equal(inc.mock.callCount(), 2);
    assert.deepEqual(out, { isFollowing: true, followersCount: 1, followingCount: 1 });
  });

  it('does not double count a repeated follow', async () => {
    mock.method(User, 'exists', async () => ({}));
    mock.method(Follow, 'create', async () => { const e = new Error('dup'); e.code = 11000; throw e; });
    const inc = mock.method(User, 'updateOne', async () => ({}));
    mock.method(User, 'findById', () => leanOf({}));
    await followUser(id(), id());
    assert.equal(inc.mock.callCount(), 0);
  });

  it('refuses self-follows and unknown targets', async () => {
    const a = id();
    await assert.rejects(followUser(a, a), /yourself/);
    mock.method(User, 'exists', async () => null);
    await assert.rejects(followUser(a, id()), /not found/);
  });

  it('only decrements when an edge was removed', async () => {
    mock.method(Follow, 'findOneAndDelete', async () => null);
    const inc = mock.method(User, 'updateOne', async () => ({}));
    mock.method(User, 'findById', () => leanOf({}));
    const out = await unfollowUser(id(), id());
    assert.equal(inc.mock.callCount(), 0);
    assert.equal(out.isFollowing, false);
  });

  it('finds mutual follows', async () => {
    const [me, x, y] = [id(), id(), id()];
    mock.method(Follow, 'find', (filter) =>
      filter.follower === me
        ? leanOf([{ followee: x }, { followee: y }])
        : leanOf([{ follower: x }])
    );
    assert.deepEqual(await getMutualIds(me), [x]);
  });

  it('treats two edges as friends', async () => {
    mock.method(Follow, 'countDocuments', async () => 2);
    assert.equal(await areMutual(id(), id()), true);
  });

  it('fixes the other side when an account is deleted', async () => {
    const [me, x, y] = [id(), id(), id()];
    mock.method(Follow, 'find', () => leanOf([{ follower: me, followee: x }, { follower: y, followee: me }]));
    const del = mock.method(Follow, 'deleteMany', async () => ({}));
    const many = mock.method(User, 'updateMany', async () => ({}));
    await deleteFollowsOf(me);
    assert.equal(del.mock.callCount(), 1);
    const updates = many.mock.calls.map((c) => [c.arguments[0]._id.$in.map(String), Object.keys(c.arguments[1].$inc)[0]]);
    assert.deepEqual(updates, [[[String(x)], 'followersCount'], [[String(y)], 'followingCount']]);
  });
});
