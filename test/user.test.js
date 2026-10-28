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
import { deleteAccount } from '../src/services/user.service.js';

describe('deleteAccount', () => {
  afterEach(() => mock.restoreAll());

  it('removes every collection keyed to the player', async () => {
    const userId = new mongoose.Types.ObjectId();
    mock.method(User, 'findByIdAndDelete', async () => ({ _id: userId }));
    const followFind = mock.method(Follow, 'find', () => ({ lean: async () => [] }));
    const models = { Session, Result, DailyAttempt, UserAchievement, LessonProgress, WordList };
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
