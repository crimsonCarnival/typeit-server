import User from '../models/user.model.js';
import Result from '../models/result.model.js';
import DailyAttempt from '../models/daily-attempt.model.js';
import UserAchievement from '../models/user-achievement.model.js';
import LessonProgress from '../models/lesson-progress.model.js';
import DigraphReview from '../models/digraph-review.model.js';
import WordList from '../models/word-list.model.js';
import Session from '../models/session.model.js';
import { USERNAME_PATTERN, publicHandle, publicName, staffRole } from '../utils/public-identity.js';
import { levelInfo } from '../config/levels.js';
import { getTestOutcomes } from './test-outcomes.service.js';
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
  const allowedUpdates = ['username', 'displayName', 'avatar', 'bio', 'timezone', 'timezoneManual'];
  const filteredUpdates = {};

  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      filteredUpdates[key] = updates[key];
    }
  }

  if (filteredUpdates.username !== undefined && !USERNAME_PATTERN.test(filteredUpdates.username)) {
    throw new Error('Username must be 3-20 letters, numbers, dots, dashes or underscores');
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
  const q = typeof query === 'string' ? query.trim().replace(/^@/, '') : '';
  if (q.length < 2) {
    return [];
  }

  const pattern = escapeRegex(q);
  const users = await User.find({
    status: 'active',
    // Accounts whose names are really emails are never matched or listed.
    username: { $not: /@/ },
    displayName: { $not: /@/ },
    $or: [
      { username: { $regex: pattern, $options: 'i' } },
      { displayName: { $regex: pattern, $options: 'i' } },
    ],
  })
    // Fetch a few extra so the closest matches can be put first.
    .limit(limit * 3)
    .select('username displayName avatar role stats.bestWpm stats.gamesPlayed stats.xp followersCount')
    .lean();

  return rankSearchResults(users, q).slice(0, limit).map((u) => ({
    id: u._id.toString(),
    username: publicHandle(u),
    displayName: publicName(u),
    avatar: u.avatar || '',
    role: staffRole(u),
    level: levelInfo(u.stats?.xp).level,
    bestWpm: u.stats?.bestWpm || 0,
    gamesPlayed: u.stats?.gamesPlayed || 0,
    followersCount: u.followersCount || 0,
  }));
};

/**
 * Orders search hits: exact username, then usernames starting with the
 * query, then display names starting with it, then anything containing it;
 * ties go to the more active player. Pure.
 */
export const rankSearchResults = (users, query) => {
  const q = query.toLowerCase();
  const score = (u) => {
    const name = (u.username || '').toLowerCase();
    const display = (u.displayName || '').toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (display.startsWith(q)) return 2;
    return 3;
  };
  return [...users].sort((a, b) => score(a) - score(b) || (b.stats?.gamesPlayed || 0) - (a.stats?.gamesPlayed || 0));
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
  }).select('displayName username avatar role bio stats createdAt followersCount followingCount');

  if (!user) return null;
  const isOwner = viewerId ? String(viewerId) === String(user._id) : false;

  return {
    id: user._id,
    displayName: publicName(user),
    username: publicHandle(user),
    avatar: user.avatar,
    role: staffRole(user),
    level: levelInfo(user.stats?.xp).level,
    bio: user.bio || '',
    stats: user.stats,
    createdAt: user.createdAt,
    followersCount: user.followersCount ?? 0,
    followingCount: user.followingCount ?? 0,
    outcomes: await getTestOutcomes(user._id),
    isFollowing: viewerId && !isOwner ? await isFollowing(viewerId, user._id) : false,
    isOwner,
  };
};
