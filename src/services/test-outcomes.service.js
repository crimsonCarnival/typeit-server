import mongoose from 'mongoose';
import Result from '../models/result.model.js';
import User from '../models/user.model.js';
import { INTEGRITY_FLAGS } from '../config/integrity.js';

/**
 * Flags that only say what the text was, not that anything was wrong: a run
 * on the player's own text, or on casual text, is never ranked but did
 * nothing to fail. Every other flag means the checks rejected the run.
 */
export const BY_DESIGN_FLAGS = Object.freeze([INTEGRITY_FLAGS.CLIENT_TEXT, INTEGRITY_FLAGS.CASUAL_TEXT]);

/**
 * Turns the counts into what a profile shows. A test is started with its
 * first key; it is finished when its result is saved, and a started test
 * that never got there was abandoned. Of the finished ones, `approved` passed
 * the integrity checks and `failed` was flagged by them. Runs saved before
 * the checks existed were never assessed: they are finished, neither.
 *
 * @param {{ finished?: number, assessedFailed?: number, assessedPassed?: number }} counts
 * @param {number} testsStarted  the player's stored started counter
 */
export const summarizeOutcomes = ({ finished = 0, assessedFailed = 0, assessedPassed = 0 } = {}, testsStarted = 0) => {
  // Accounts from before started tests were counted have started at least what they finished.
  const started = Math.max(Number(testsStarted) || 0, finished);
  return {
    started,
    abandoned: started - finished,
    finished,
    approved: assessedPassed,
    failed: assessedFailed,
  };
};

/** A player's started / abandoned / finished (approved, failed) counts, from their saved results. */
export const getTestOutcomes = async (userId) => {
  const id = new mongoose.Types.ObjectId(String(userId));
  const [rows, user] = await Promise.all([
    Result.aggregate([
      { $match: { userId: id } },
      {
        $project: {
          assessed: { $gte: ['$integrityVersion', 1] },
          rejected: { $gt: [{ $size: { $setDifference: [{ $ifNull: ['$integrityFlags', []] }, BY_DESIGN_FLAGS] } }, 0] },
        },
      },
      {
        $group: {
          _id: null,
          finished: { $sum: 1 },
          assessedFailed: { $sum: { $cond: [{ $and: ['$assessed', '$rejected'] }, 1, 0] } },
          assessedPassed: { $sum: { $cond: [{ $and: ['$assessed', { $not: ['$rejected'] }] }, 1, 0] } },
        },
      },
    ]),
    User.findById(id).select('stats.testsStarted').lean(),
  ]);
  return summarizeOutcomes(rows[0], user?.stats?.testsStarted);
};
