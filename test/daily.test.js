import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import DailyChallenge from '../src/models/daily-challenge.model.js';
import DailyAttempt from '../src/models/daily-attempt.model.js';
import Session from '../src/models/session.model.js';
import {
  buildChallenge,
  claimAttempt,
  dailySeed,
  dateKey,
  nextResetAt,
  previousDates,
  recordDailyFinish,
} from '../src/services/daily.service.js';
import dailyController from '../src/controllers/daily.controller.js';
import { DAILY_SETTINGS_POOL } from '../src/config/daily.js';

const SECRET = 'test-secret';

describe('daily calendar', () => {
  it('keys days by UTC date', () => {
    assert.equal(dateKey(new Date('2026-10-27T23:59:59Z')), '2026-10-27');
    assert.equal(dateKey(new Date('2026-10-28T00:00:00Z')), '2026-10-28');
    // 21:00 in UTC-5 is already the next UTC day.
    assert.equal(dateKey(new Date('2026-10-27T21:00:00-05:00')), '2026-10-28');
  });

  it('resets at the next UTC midnight', () => {
    assert.equal(nextResetAt(new Date('2026-10-27T17:17:50Z')).toISOString(), '2026-10-28T00:00:00.000Z');
    assert.equal(nextResetAt(new Date('2026-12-31T12:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z');
  });

  it('lists the previous days, most recent first, across month ends', () => {
    assert.deepEqual(previousDates('2026-11-02', 3), ['2026-11-01', '2026-10-31', '2026-10-30']);
  });
});

describe('daily challenge generation', () => {
  it('is identical for everyone on the same day', () => {
    assert.deepEqual(buildChallenge('2026-10-28', SECRET), buildChallenge('2026-10-28', SECRET));
  });

  it('differs between days', () => {
    assert.notEqual(buildChallenge('2026-10-28', SECRET).text, buildChallenge('2026-10-29', SECRET).text);
  });

  it('cannot be predicted without the server secret', () => {
    assert.notEqual(dailySeed('2026-10-28', SECRET), dailySeed('2026-10-28', 'other-secret'));
    assert.notEqual(buildChallenge('2026-10-28', SECRET).text, buildChallenge('2026-10-28', 'other-secret').text);
  });

  it('uses settings from the pool and honours its modifiers', () => {
    for (let d = 1; d <= 30; d++) {
      const date = `2026-11-${String(d).padStart(2, '0')}`;
      const c = buildChallenge(date, SECRET);
      const { wordCount, timeMax, punctuationEnabled, numbersEnabled } = c;
      assert.ok(
        DAILY_SETTINGS_POOL.some((p) =>
          p.wordCount === wordCount && p.timeMax === timeMax &&
          p.punctuationEnabled === punctuationEnabled && p.numbersEnabled === numbersEnabled),
        date
      );
      assert.equal(c.gameMode, 'words');
      if (!punctuationEnabled) assert.doesNotMatch(c.text, /[.,!?;:]/, date);
      if (!numbersEnabled) assert.doesNotMatch(c.text, /\d/, date);
      assert.equal(c.totalWords, c.text.split(' ').length);
      // Number tokens are extra words on top of the requested count.
      assert.ok(c.totalWords >= wordCount, date);
    }
  });
});

describe('one attempt per player per day', () => {
  afterEach(() => mock.restoreAll());
  const userId = new mongoose.Types.ObjectId();

  it('claims the first attempt and refuses a second', async () => {
    let created = 0;
    mock.method(DailyAttempt, 'create', async () => {
      created++;
      if (created > 1) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      return {};
    });
    assert.equal(await claimAttempt(userId, '2026-10-28', new Date()), true);
    assert.equal(await claimAttempt(userId, '2026-10-28', new Date()), false);
  });

  it('lets the unique index settle concurrent starts', async () => {
    const seen = new Set();
    mock.method(DailyAttempt, 'create', async ({ userId: u, date }) => {
      const key = `${u}|${date}`;
      if (seen.has(key)) throw Object.assign(new Error('E11000'), { code: 11000 });
      seen.add(key);
      return {};
    });
    const results = await Promise.all([1, 2, 3].map(() => claimAttempt(userId, '2026-10-28', new Date())));
    assert.deepEqual(results.sort(), [false, false, true]);
  });

  it('surfaces errors other than a duplicate', async () => {
    mock.method(DailyAttempt, 'create', async () => { throw new Error('db down'); });
    await assert.rejects(claimAttempt(userId, '2026-10-28', new Date()), /db down/);
  });

  it('records only the first finish of an attempt', async () => {
    const update = mock.method(DailyAttempt, 'updateOne', async () => ({}));
    await recordDailyFinish(userId, '2026-10-28', { resultId: 'r', wpm: 80, accuracy: 97, ranked: true });
    const [filter, change] = update.mock.calls[0].arguments;
    assert.deepEqual(filter, { userId, date: '2026-10-28', finishedAt: null });
    assert.equal(change.$set.wpm, 80);
    assert.equal(change.$set.ranked, true);
  });
});

describe('POST /daily/start', () => {
  afterEach(() => mock.restoreAll());

  const challenge = { ...buildChallenge('2026-10-28', SECRET) };
  const call = async () => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await dailyController.start({ user: { _id: new mongoose.Types.ObjectId() } }, res);
    return res;
  };

  it('answers 409 without touching the session when already played', async () => {
    mock.method(DailyChallenge, 'findOne', () => ({ lean: async () => challenge }));
    mock.method(DailyAttempt, 'create', async () => { throw Object.assign(new Error('dup'), { code: 11000 }); });
    const findSession = mock.method(Session, 'findOne', () => { throw new Error('should not be called'); });

    const res = await call();
    assert.equal(res.statusCode, 409);
    assert.equal(findSession.mock.callCount(), 0);
  });

  it('releases the attempt when the run cannot be started', async () => {
    mock.method(DailyChallenge, 'findOne', () => ({ lean: async () => challenge }));
    mock.method(DailyAttempt, 'create', async () => ({}));
    mock.method(Session, 'findOne', () => { throw new Error('db down'); });
    const release = mock.method(DailyAttempt, 'deleteOne', async () => ({}));

    const res = await call();
    assert.equal(res.statusCode, 500);
    assert.equal(release.mock.callCount(), 1);
    assert.equal(release.mock.calls[0].arguments[0].finishedAt, null);
  });
});
