import User from '../models/user.model.js';
import Result from '../models/result.model.js';
import Session from '../models/session.model.js';

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

  await Promise.allSettled([
    Session.deleteMany({ userId }),
    Result.deleteMany({ userId }),
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
  }).select('displayName username avatar bio stats createdAt followers following');

  if (!user) return null;

  return {
    id: user._id,
    displayName: user.displayName || user.username,
    username: user.username,
    avatar: user.avatar,
    bio: user.bio || '',
    stats: user.stats,
    createdAt: user.createdAt,
    followersCount: user.followers.length,
    followingCount: user.following.length,
    isFollowing: viewerId
      ? user.followers.some((id) => id.toString() === viewerId.toString())
      : false,
    isOwner: viewerId ? viewerId.toString() === user._id.toString() : false,
  };
};

/**
 * Makes `followerId` follow `targetId`.
 */
export const followUser = async (followerId, targetId) => {
  if (followerId.toString() === targetId.toString()) {
    throw new Error('You cannot follow yourself');
  }

  const target = await User.findOne({ _id: targetId, status: 'active' });
  if (!target) {
    throw new Error('User not found');
  }

  await Promise.all([
    User.findByIdAndUpdate(followerId, { $addToSet: { following: targetId } }),
    User.findByIdAndUpdate(targetId, { $addToSet: { followers: followerId } }),
  ]);

  const [targetUser, follower] = await Promise.all([
    User.findById(targetId).select('followers'),
    User.findById(followerId).select('following'),
  ]);

  return {
    isFollowing: true,
    followersCount: targetUser.followers.length,
    followingCount: follower.following.length,
  };
};

/**
 * Makes `followerId` unfollow `targetId`.
 */
export const unfollowUser = async (followerId, targetId) => {
  if (followerId.toString() === targetId.toString()) {
    throw new Error('You cannot unfollow yourself');
  }

  await Promise.all([
    User.findByIdAndUpdate(followerId, { $pull: { following: targetId } }),
    User.findByIdAndUpdate(targetId, { $pull: { followers: followerId } }),
  ]);

  const [targetUser, follower] = await Promise.all([
    User.findById(targetId).select('followers'),
    User.findById(followerId).select('following'),
  ]);

  return {
    isFollowing: false,
    followersCount: targetUser?.followers.length || 0,
    followingCount: follower?.following.length || 0,
  };
};

/**
 * Lists the users that follow `userId`.
 */
export const getFollowers = async (userId) => {
  const user = await User.findById(userId)
    .select('followers')
    .populate('followers', 'username displayName avatar stats.bestWpm');

  return user ? user.followers : [];
};

/**
 * Lists the users that `userId` follows.
 */
export const getFollowing = async (userId) => {
  const user = await User.findById(userId)
    .select('following')
    .populate('following', 'username displayName avatar stats.bestWpm');

  return user ? user.following : [];
};
