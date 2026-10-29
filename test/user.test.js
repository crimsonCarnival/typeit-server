import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../src/models/user.model.js';
import Session from '../src/models/session.model.js';
import Result from '../src/models/result.model.js';
import DailyAttempt from '../src/models/daily-attempt.model.js';
import UserAchievement from '../src/models/user-achievement.model.js';
import LessonProgress from '../src/models/lesson-progress.model.js';
import WordList from '../src/models/word-list.model.js';
import Follow from '../src/models/follow.model.js';
import DigraphReview from '../src/models/digraph-review.model.js';
import { deleteAccount } from '../src/services/user.service.js';

describe('deleteAccount', () => {
  afterEach(() => mock.restoreAll());

  it('removes every collection keyed to the player', async () => {
    const userId = new mongoose.Types.ObjectId();
    mock.method(User, 'findByIdAndDelete', async () => ({ _id: userId }));
    const followFind = mock.method(Follow, 'find', () => ({ lean: async () => [] }));
    const models = { Session, Result, DailyAttempt, UserAchievement, LessonProgress, WordList, DigraphReview };
    const calls = Object.fromEntries(
      Object.entries(models).map(([name, model]) => [name, mock.method(model, 'deleteMany', async () => ({}))])
    );

    assert.equal(await deleteAccount(userId), true);
    for (const [name, call] of Object.entries(calls)) {
      assert.equal(call.mock.callCount(), 1, name);
      assert.deepEqual(call.mock.calls[0].arguments[0], { userId }, name);
    }
    assert.equal(followFind.mock.callCount(), 1);
  });

  it('does nothing when the account does not exist', async () => {
    mock.method(User, 'findByIdAndDelete', async () => null);
    const del = mock.method(Result, 'deleteMany', async () => ({}));
    assert.equal(await deleteAccount(new mongoose.Types.ObjectId()), false);
    assert.equal(del.mock.callCount(), 0);
  });
});

describe('searchUsers', async () => {
  const { searchUsers, rankSearchResults } = await import('../src/services/user.service.js');
  afterEach(() => mock.restoreAll());

  it('puts exact and prefix username matches first', () => {
    const users = [
      { username: 'the_ann', displayName: 'X', stats: { gamesPlayed: 50 } },
      { username: 'bob', displayName: 'Ann Lee', stats: { gamesPlayed: 1 } },
      { username: 'annie', displayName: 'Y', stats: { gamesPlayed: 2 } },
      { username: 'ann', displayName: 'Z', stats: { gamesPlayed: 0 } },
    ];
    assert.deepEqual(rankSearchResults(users, 'ann').map((u) => u.username), ['ann', 'annie', 'bob', 'the_ann']);
  });

  it('needs two characters, ignores a leading @ and returns public fields only', async () => {
    assert.deepEqual(await searchUsers('a'), []);
    let filter;
    mock.method(User, 'find', (f) => {
      filter = f;
      return { limit: () => ({ select: () => ({ lean: async () => [{ _id: new mongoose.Types.ObjectId(), username: 'ann', displayName: '', email: 'x@y.z', stats: { bestWpm: 70 } }] }) }) };
    });
    const [hit] = await searchUsers('@a.n');
    assert.equal(filter.status, 'active');
    assert.equal(filter.$or[0].username.$regex, 'a\\.n');
    assert.deepEqual(Object.keys(hit).sort(), ['avatar', 'bestWpm', 'displayName', 'followersCount', 'gamesPlayed', 'id', 'level', 'role', 'username']);
    assert.equal(hit.displayName, 'ann');
    assert.equal(hit.role, undefined, 'a player role is never shown, only staff roles');
    assert.equal(hit.level, 0);
  });
});
