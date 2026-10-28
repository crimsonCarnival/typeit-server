import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Result from '../src/models/result.model.js';
import statsController from '../src/controllers/stats.controller.js';

const fakeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

describe('GET /stats/history', () => {
  afterEach(() => mock.restoreAll());

  it('keeps the newest runs and returns them oldest first', async () => {
    const day = (d) => new Date(Date.UTC(2026, 0, d));
    // What Mongo returns for sort({ createdAt: -1 }).limit(2).
    const newestFirst = [
      { _id: new mongoose.Types.ObjectId(), wpm: 90, rawWpm: 95, createdAt: day(3) },
      { _id: new mongoose.Types.ObjectId(), wpm: 80, rawWpm: 85, createdAt: day(2) },
    ];
    let sortArg;
    let limitArg;
    mock.method(Result, 'find', () => ({
      sort(arg) { sortArg = arg; return this; },
      limit(arg) { limitArg = arg; return this; },
      select() { return this; },
      lean: async () => newestFirst.map((r) => ({ ...r })),
    }));

    const res = fakeRes();
    await statsController.getHistory({ user: { _id: 'u1' }, query: { limit: '2' } }, res);

    assert.deepEqual(sortArg, { createdAt: -1 });
    assert.equal(limitArg, 2);
    assert.deepEqual(res.body.data.sessions.map((s) => s.wpm), [80, 90]);
    assert.deepEqual(res.body.data.sessions.map((s) => s.rawWpm), [85, 95]);
  });
});

describe('Result schema', () => {
  it('stores the run-level raw WPM', () => {
    const doc = new Result({ rawWpm: 77 });
    assert.equal(doc.rawWpm, 77);
  });
});
