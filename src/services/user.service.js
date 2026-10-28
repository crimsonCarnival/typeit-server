import User from '../models/user.model.js';
import Result from '../models/result.model.js';
import DailyAttempt from '../models/daily-attempt.model.js';
import UserAchievement from '../models/user-achievement.model.js';
import LessonProgress from '../models/lesson-progress.model.js';
import DigraphReview from '../models/digraph-review.model.js';
import WordList from '../models/word-list.model.js';
import Session from '../models/session.model.js';
import { deleteFollowsOf, isFollowing } from './follow.service.js';

export { followUser, unfollowUser, getFollowers, getFollowing } from './follow.service.js';

/**
 * Escapes regex-special characters in user input used for pattern matching.
 */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Gets user profile by ID
 */
export const getProfile = async (userId) => {
  return await User.findById(userId).select('-password');
};

/**
 * Updates user profile
 */
export const updateProfile = async (userId, updates) => {
  const allowedUpdates = ['username', 'displayName', 'avatar', 'bio', 'timezone'];
  const filteredUpdates = {};

  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      filteredUpdates[key] = updates[key];
    }
  }

  // Check if username is taken (if updating username)
  if (filteredUpdates.username) {
    const existing = await User.findOne({
      username: filteredUpdates.username,
      _id: { $ne: userId }
    });
    if (existing) {
      throw new Error('Username already taken');
    }
  }

  return await User.findByIdAndUpdate(
    userId,
    { $set: filteredUpdates },
    { new: true }
  ).select('-password');
};

/**
 * Gets all users for leaderboard (sorted by high score)
 */
export const getLeaderboard = async (limit = 10, sortBy = 'highScore') => {
  const sortField = sortBy === 'wpm' ? 'stats.bestWpm' : 'stats.highScore';
  
  return await User.find({ status: 'active' })
    .sort({ [sortField]: -1 })
    .limit(limit)
    .select('username displayName avatar stats');
};

/**
 * Deletes user account and their associated sessions/results.
 */
export const deleteAccount = async (userId) => {
  const result = await User.findByIdAndDelete(userId);
  if (!result) return false;

  // Everything keyed to the player goes with the account. Finished races
  // keep their entry (other racers' history) but it only holds the id.
  await Promise.allSettled([
    Session.deleteMany({ userId }),
    Result.deleteMany({ userId }),
    DailyAttempt.deleteMany({ userId }),
    UserAchievement.deleteMany({ userId }),
    LessonProgress.deleteMany({ userId }),
    WordList.deleteMany({ userId }),
    DigraphReview.deleteMany({ userId }),
    deleteFollowsOf(userId),
  ]);

  return true;
};

/**
 * Search users by username (public profiles only)
 */
export const searchUsers = async (query, limit = 20) => {
  if (!query || query.length < 2) {
    return [];
  }

  return await User.find({
    status: 'active',
    $or: [
      { username: { $regex: escapeRegex(query), $options: 'i' } },
      { displayName: { $regex: escapeRegex(query), $options: 'i' } },
    ],
  })
    .limit(limit)
    .select('username displayName avatar stats.highScore stats.bestWpm stats.gamesPlayed');
};

/**
 * Get user's public profile by ID.
 * Includes follower/following counts and, when a viewer is provided,
 * whether the viewer follows this user.
 */
export const getPublicProfile = async (userId, viewerId = null) => {
  const user = await User.findOne({
    _id: userId,
    status: 'active'
  }).select('displayName username avatar bio stats createdAt followersCount followingCount');

  if (!user) return null;
  const isOwner = viewerId ? String(viewerId) === String(user._id) : false;

  return {
    id: user._id,
    displayName: user.displayName || user.username,
    username: user.username,
    avatar: user.avatar,
    bio: user.bio || '',
    stats: user.stats,
    createdAt: user.createdAt,
    followersCount: user.followersCount ?? 0,
    followingCount: user.followingCount ?? 0,
    isFollowing: viewerId && !isOwner ? await isFollowing(viewerId, user._id) : false,
    isOwner,
  };
};
