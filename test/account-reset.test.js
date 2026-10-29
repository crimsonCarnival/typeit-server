import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../src/models/user.model.js';
import Result from '../src/models/result.model.js';
import Session from '../src/models/session.model.js';
import DailyAttempt from '../src/models/daily-attempt.model.js';
import UserAchievement from '../src/models/user-achievement.model.js';
import LessonProgress from '../src/models/lesson-progress.model.js';
import DigraphReview from '../src/models/digraph-review.model.js';
import WordList from '../src/models/word-list.model.js';
import Notification from '../src/models/notification.model.js';
import { resetAccount } from '../src/services/user.service.js';

/** User.findById(...).select(...) as the service awaits it. */
const found = (value) => ({ select: () => Promise.resolve(value) });

describe('resetAccount', () => {
  afterEach(() => mock.restoreAll());

  const wipes = () => {
    const calls = {};
    for (const [name, model] of Object.entries({ Session, Result, DailyAttempt, UserAchievement, LessonProgress, DigraphReview, Notification })) {
      calls[name] = mock.method(model, 'deleteMany', async () => ({}));
    }
    calls.WordList = mock.method(WordList, 'deleteMany', async () => ({}));
    return calls;
  };

  it('deletes the player\'s runs, badges, lessons, daily attempts and notifications', async () => {
    const calls = wipes();
    mock.method(User, 'findById', () => found({ _id: 1 }));
    mock.method(User, 'updateOne', async () => ({}));
    const userId = new mongoose.Types.ObjectId();
    assert.equal(await resetAccount(userId), true);
    for (const name of ['Session', 'Result', 'DailyAttempt', 'UserAchievement', 'LessonProgress', 'DigraphReview', 'Notification']) {
      assert.deepEqual(calls[name].mock.calls[0].arguments[0], { userId }, name);
    }
  });

  it('keeps who the player is: word lists stay, and only stats and session pointers are cleared', async () => {
    const calls = wipes();
    mock.method(User, 'findById', () => found({ _id: 1 }));
    const update = mock.method(User, 'updateOne', async () => ({}));
    await resetAccount(new mongoose.Types.ObjectId());
    assert.equal(calls.WordList.mock.callCount(), 0, 'word lists are theirs');
    const change = update.mock.calls[0].arguments[1];
    assert.deepEqual(change.$unset, { stats: 1 });
    assert.deepEqual(Object.keys(change.$set).sort(), ['lastSession', 'lastSessionAt', 'notificationsSyncedAt']);
    assert.equal(Object.keys(change).includes('$unset') && 'username' in change.$unset, false, 'identity fields are untouched');
  });

  it('answers false for an account that does not exist, and deletes nothing', async () => {
    const calls = wipes();
    mock.method(User, 'findById', () => found(null));
    assert.equal(await resetAccount(new mongoose.Types.ObjectId()), false);
    assert.equal(calls.Result.mock.callCount(), 0);
  });
});
