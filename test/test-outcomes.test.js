import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import Result from '../src/models/result.model.js';
import User from '../src/models/user.model.js';
import { BY_DESIGN_FLAGS, getTestOutcomes, summarizeOutcomes } from '../src/services/test-outcomes.service.js';
import { INTEGRITY_FLAGS } from '../src/config/integrity.js';

const leanOf = (value) => ({ select() { return this; }, lean: async () => value });

describe('summarizeOutcomes', () => {
  it('abandoned is what was started but never finished', () => {
    assert.deepEqual(summarizeOutcomes({ finished: 7, assessedPassed: 5, assessedFailed: 2 }, 10), {
      started: 10,
      abandoned: 3,
      finished: 7,
      approved: 5,
      failed: 2,
    });
  });

  it('nothing started and nothing finished is all zeros', () => {
    assert.deepEqual(summarizeOutcomes(undefined, undefined), { started: 0, abandoned: 0, finished: 0, approved: 0, failed: 0 });
  });

  it('an account from before starts were counted never shows negative abandoned', () => {
    const out = summarizeOutcomes({ finished: 40, assessedPassed: 40 }, 0);
    assert.deepEqual([out.started, out.abandoned], [40, 0]);
  });

  it('runs never assessed by the checks are finished, but neither approved nor failed', () => {
    const out = summarizeOutcomes({ finished: 10, assessedPassed: 6, assessedFailed: 1 }, 10);
    assert.equal(out.finished, 10);
    assert.equal(out.approved + out.failed, 7);
  });
});

describe('what counts as a failed test', () => {
  it('a run on the player\'s own or casual text is not a failure: it is just never ranked', () => {
    assert.deepEqual([...BY_DESIGN_FLAGS].sort(), [INTEGRITY_FLAGS.CASUAL_TEXT, INTEGRITY_FLAGS.CLIENT_TEXT].sort());
  });
});

describe('getTestOutcomes', () => {
  afterEach(() => mock.restoreAll());

  it('counts finished from saved results and started from the stored counter', async () => {
    const pipeline = [];
    mock.method(Result, 'aggregate', async (stages) => {
      pipeline.push(...stages);
      return [{ _id: null, finished: 12, assessedPassed: 9, assessedFailed: 2 }];
    });
    mock.method(User, 'findById', () => leanOf({ stats: { testsStarted: 20 } }));
    const userId = new mongoose.Types.ObjectId();
    const out = await getTestOutcomes(userId);
    assert.deepEqual(out, { started: 20, abandoned: 8, finished: 12, approved: 9, failed: 2 });
    assert.deepEqual(pipeline[0].$match.userId, userId, 'only this player\'s results');
  });

  it('judges failure only from flags other than the by-design ones, and only for assessed runs', async () => {
    let stages;
    mock.method(Result, 'aggregate', async (s) => {
      stages = s;
      return [];
    });
    mock.method(User, 'findById', () => leanOf(null));
    await getTestOutcomes(new mongoose.Types.ObjectId());
    const rejected = stages[1].$project.rejected;
    assert.deepEqual(rejected.$gt[0].$size.$setDifference[1], [...BY_DESIGN_FLAGS]);
    assert.deepEqual(stages[1].$project.assessed, { $gte: ['$integrityVersion', 1] });
  });

  it('a player with no results and no starts has nothing', async () => {
    mock.method(Result, 'aggregate', async () => []);
    mock.method(User, 'findById', () => leanOf({ stats: {} }));
    assert.deepEqual(await getTestOutcomes(new mongoose.Types.ObjectId()), { started: 0, abandoned: 0, finished: 0, approved: 0, failed: 0 });
  });
});
