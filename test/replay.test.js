import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Result from '../src/models/result.model.js';
import DailyAttempt from '../src/models/daily-attempt.model.js';
import { getReplay, ghostTimeline, startDailyGhostRun } from '../src/services/replay.service.js';

const owner = new mongoose.Types.ObjectId();
const log = (chars, gap = 100) => [...chars].map((c, i) => [i === 0 ? 0 : gap, c]);

const stored = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  userId: { _id: owner, username: 'ann', displayName: 'Ann', status: 'active' },
  text: 'abc def',
  keystrokes: log('abc def'),
  rules: { difficulty: 'normal', stopOnError: 'off', spaceSkips: false },
  leadMs: 0,
  timeMax: 30,
  ranked: true,
  dailyDate: null,
  ...overrides,
});

const stubFind = (doc) =>
  mock.method(Result, 'findById', () => ({ select: () => ({ populate: () => ({ lean: async () => doc }) }) }));

describe('ghostTimeline', () => {
  it('follows the replayed cursor, shifted by the lead time', () => {
    const t = ghostTimeline({ text: 'ab', keystrokes: [[0, 'a'], [100, 'x'], [100, '\b'], [100, 'b']], rules: {}, leadMs: 500, timeMax: 30 });
    assert.deepEqual(t, [[500, 1], [600, 2], [700, 1], [800, 2]]);
  });
});

describe('getReplay', () => {
  afterEach(() => mock.restoreAll());

  it('shows anyone a ranked run', async () => {
    stubFind(stored());
    const r = await getReplay('x', null);
    assert.equal(r.player.displayName, 'Ann');
    assert.equal(r.text, 'abc def');
  });

  it('keeps unranked runs private to their player', async () => {
    stubFind(stored({ ranked: false }));
    assert.equal(await getReplay('x', new mongoose.Types.ObjectId()), null);
    stubFind(stored({ ranked: false }));
    assert.ok(await getReplay('x', owner));
  });

  it("hides today's daily text from other players", async () => {
    stubFind(stored({ dailyDate: new Date().toISOString().slice(0, 10) }));
    assert.equal(await getReplay('x', null), null);
  });

  it('has nothing to show without a keystroke log', async () => {
    stubFind(stored({ keystrokes: undefined }));
    assert.equal(await getReplay('x', owner), null);
  });
});

describe('startDailyGhostRun', () => {
  afterEach(() => mock.restoreAll());
  const now = new Date('2026-10-28T12:00:00Z');

  it("requires finishing today's attempt first", async () => {
    mock.method(DailyAttempt, 'findOne', () => ({ select: () => ({ lean: async () => ({ finishedAt: null }) }) }));
    const out = await startDailyGhostRun(owner, '2026-10-28', now);
    assert.equal(out.status, 403);
  });

  it('refuses future days', async () => {
    const out = await startDailyGhostRun(owner, '2026-10-29', now);
    assert.equal(out.status, 404);
  });
});
