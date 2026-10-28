import mongoose from 'mongoose';
import Follow from '../models/follow.model.js';
import User from '../models/user.model.js';

export const FOLLOW_LIST_LIMIT = 100;
const LIST_FIELDS = 'username displayName avatar stats.bestWpm';

const DUPLICATE_KEY = 11000;

const countsOf = async (followerId, targetId) => {
  const [target, follower] = await Promise.all([
    User.findById(targetId).select('followersCount').lean(),
    User.findById(followerId).select('followingCount').lean(),
  ]);
  return {
    followersCount: target?.followersCount ?? 0,
    followingCount: follower?.followingCount ?? 0,
  };
};

/**
 * Makes `followerId` follow `targetId`. Idempotent: following twice keeps one
 * edge and the counters unchanged.
 */
export const followUser = async (followerId, targetId) => {
  if (String(followerId) === String(targetId)) {
    throw new Error('You cannot follow yourself');
  }

  const target = await User.exists({ _id: targetId, status: 'active' });
  if (!target) {
    throw new Error('User not found');
  }

  let created = false;
  try {
    await Follow.create({ follower: followerId, followee: targetId });
    created = true;
  } catch (e) {
    if (e?.code !== DUPLICATE_KEY) throw e;
  }
  if (created) {
    await Promise.all([
      User.updateOne({ _id: followerId }, { $inc: { followingCount: 1 } }),
      User.updateOne({ _id: targetId }, { $inc: { followersCount: 1 } }),
    ]);
  }

  return { isFollowing: true, ...(await countsOf(followerId, targetId)) };
};

/**
 * Makes `followerId` unfollow `targetId`. Idempotent.
 */
export const unfollowUser = async (followerId, targetId) => {
  if (String(followerId) === String(targetId)) {
    throw new Error('You cannot unfollow yourself');
  }

  const removed = await Follow.findOneAndDelete({ follower: followerId, followee: targetId });
  if (removed) {
    await Promise.all([
      User.updateOne({ _id: followerId, followingCount: { $gt: 0 } }, { $inc: { followingCount: -1 } }),
      User.updateOne({ _id: targetId, followersCount: { $gt: 0 } }, { $inc: { followersCount: -1 } }),
    ]);
  }

  return { isFollowing: false, ...(await countsOf(followerId, targetId)) };
};

export const isFollowing = async (followerId, targetId) =>
  !!(await Follow.exists({ follower: followerId, followee: targetId }));

/** Users on one side of `userId`'s edges, newest first, active accounts only. */
const listSide = async (filter, otherSide, limit) => {
  const edges = await Follow.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, FOLLOW_LIST_LIMIT))
    .select(otherSide)
    .lean();
  const ids = edges.map((e) => e[otherSide]);
  const users = await User.find({ _id: { $in: ids }, status: 'active' }).select(LIST_FIELDS).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
};

/** Users that follow `userId`. */
export const getFollowers = (userId, limit = FOLLOW_LIST_LIMIT) =>
  listSide({ followee: userId }, 'follower', limit);

/** Users that `userId` follows. */
export const getFollowing = (userId, limit = FOLLOW_LIST_LIMIT) =>
  listSide({ follower: userId }, 'followee', limit);

/** Ids of users who follow `userId` and are followed back (race friends). */
export const getMutualIds = async (userId) => {
  const following = await Follow.find({ follower: userId }).select('followee').lean();
  if (following.length === 0) return [];
  const back = await Follow.find({
    follower: { $in: following.map((f) => f.followee) },
    followee: userId,
  }).select('follower').lean();
  return back.map((f) => f.follower);
};

/** Whether `a` and `b` follow each other. */
export const areMutual = async (a, b) => {
  const n = await Follow.countDocuments({
    $or: [
      { follower: a, followee: b },
      { follower: b, followee: a },
    ],
  });
  return n === 2;
};

/**
 * Removes every edge touching a deleted account and fixes the other side's
 * counters.
 */
export const deleteFollowsOf = async (userId) => {
  const id = new mongoose.Types.ObjectId(String(userId));
  const edges = await Follow.find({ $or: [{ follower: id }, { followee: id }] }).lean();
  if (edges.length === 0) return;
  const followedByThem = edges.filter((e) => String(e.follower) === String(id)).map((e) => e.followee);
  const followingThem = edges.filter((e) => String(e.followee) === String(id)).map((e) => e.follower);
  await Follow.deleteMany({ $or: [{ follower: id }, { followee: id }] });
  await Promise.all([
    followedByThem.length && User.updateMany({ _id: { $in: followedByThem }, followersCount: { $gt: 0 } }, { $inc: { followersCount: -1 } }),
    followingThem.length && User.updateMany({ _id: { $in: followingThem }, followingCount: { $gt: 0 } }, { $inc: { followingCount: -1 } }),
  ]);
};
