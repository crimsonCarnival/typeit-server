import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../src/models/user.model.js';
import Follow from '../src/models/follow.model.js';
import { Block, BlockError, _clearBlockCache, block, blockedBy, blockedByCached, eitherBlocked, unblock } from '../src/services/block.service.js';
import { followUser } from '../src/services/follow.service.js';

const id = () => String(new mongoose.Types.ObjectId());
const rows = (list) => ({ select: () => ({ lean: async () => list }) });

describe('blocking', () => {
  afterEach(() => {
    mock.restoreAll();
    _clearBlockCache();
  });

  it('removes follows both ways and remembers the block', async () => {
    const [me, them] = [id(), id()];
    mock.method(User, 'exists', async () => ({ _id: them }));
    mock.method(Block, 'countDocuments', async () => 0);
    const upsert = mock.method(Block, 'updateOne', async () => ({}));
    mock.method(Block, 'find', () => rows([]));
    const unfollow = mock.method(Follow, 'findOneAndDelete', async () => ({}));
    const counters = mock.method(User, 'updateOne', async () => ({}));
    await block(me, them);
    assert.equal(upsert.mock.callCount(), 1);
    assert.deepEqual(unfollow.mock.calls.map((c) => [c.arguments[0].follower, c.arguments[0].followee]), [[me, them], [them, me]]);
    assert.equal(counters.mock.callCount(), 4, 'both edges, both counters');
    assert.equal((await blockedBy(me)).has(them), true);
    assert.equal(blockedByCached(me).has(them), true);
  });

  it('refuses blocking yourself, or someone who does not exist', async () => {
    const me = id();
    await assert.rejects(block(me, me), BlockError);
    mock.method(User, 'exists', async () => null);
    await assert.rejects(block(me, id()), /not found/);
  });

  it('works whichever side blocked', async () => {
    const [a, b] = [id(), id()];
    mock.method(Block, 'find', (q) => rows(q.blocker === b ? [{ blocked: a }] : []));
    assert.equal(await eitherBlocked(a, b), true);
    assert.equal(await eitherBlocked(b, a), true);
  });

  it('unblocking forgets it', async () => {
    const [me, them] = [id(), id()];
    mock.method(Block, 'find', () => rows([{ blocked: them }]));
    mock.method(Block, 'deleteOne', async () => ({}));
    assert.equal((await blockedBy(me)).has(them), true);
    await unblock(me, them);
    assert.equal(blockedByCached(me).has(them), false);
  });

  it('a blocked player cannot follow, and is told only "not found"', async () => {
    const [me, them] = [id(), id()];
    mock.method(User, 'exists', async () => ({ _id: them }));
    mock.method(Block, 'find', (q) => rows(q.blocker === them ? [{ blocked: me }] : []));
    const create = mock.method(Follow, 'create', async () => ({}));
    await assert.rejects(followUser(me, them), /User not found/);
    assert.equal(create.mock.callCount(), 0);
  });
});
