import mongoose, { Schema } from 'mongoose';
import User from '../models/user.model.js';
import Follow from '../models/follow.model.js';
import { publicHandle, publicName } from '../utils/public-identity.js';

/*
 * Blocking. When A blocks B:
 * - any follow between them, either way, is removed, and neither can follow the other;
 * - neither can invite the other to a race, and B can't join a room A hosts;
 * - A no longer sees B's race chat;
 * - nothing tells B they were blocked (they see the same "not found" as anyone).
 * Profiles stay public, as they are for everyone.
 */

export const BLOCK_LIMIT = 500;

const blockSchema = new Schema(
  {
    blocker: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    blocked: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);
blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
blockSchema.index({ blocked: 1 });
export const Block = mongoose.models.Block || mongoose.model('Block', blockSchema);

// Who each player has blocked, kept in memory for the race socket (chat is filtered per message).
const cache = new Map(); // userId -> Set<userId>

export class BlockError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** The ids a player has blocked (cached). */
export const blockedBy = async (userId) => {
  const key = String(userId);
  if (!cache.has(key)) {
    const rows = await Block.find({ blocker: key }).select('blocked').lean();
    cache.set(key, new Set(rows.map((r) => String(r.blocked))));
  }
  return cache.get(key);
};

/** Cached only: for hot paths that must not wait (chat). Unknown players block nobody. */
export const blockedByCached = (userId) => cache.get(String(userId)) ?? new Set();

/** Whether either player has blocked the other. */
export const eitherBlocked = async (a, b) => (await blockedBy(a)).has(String(b)) || (await blockedBy(b)).has(String(a));

export const block = async (userId, targetId) => {
  if (String(userId) === String(targetId)) throw new BlockError('You cannot block yourself');
  if (!(await User.exists({ _id: targetId }))) throw new BlockError('User not found', 404);
  if ((await Block.countDocuments({ blocker: userId })) >= BLOCK_LIMIT) throw new BlockError(`You can block up to ${BLOCK_LIMIT} players`);
  await Block.updateOne({ blocker: userId, blocked: targetId }, { $setOnInsert: { blocker: userId, blocked: targetId } }, { upsert: true });
  (await blockedBy(userId)).add(String(targetId));
  // Follows either way go, and the counters with them.
  for (const [follower, followee] of [[userId, targetId], [targetId, userId]]) {
    const removed = await Follow.findOneAndDelete({ follower, followee });
    if (removed) {
      await User.updateOne({ _id: follower, followingCount: { $gt: 0 } }, { $inc: { followingCount: -1 } });
      await User.updateOne({ _id: followee, followersCount: { $gt: 0 } }, { $inc: { followersCount: -1 } });
    }
  }
};

export const unblock = async (userId, targetId) => {
  await Block.deleteOne({ blocker: userId, blocked: targetId });
  (await blockedBy(userId)).delete(String(targetId));
};

/** The players someone has blocked, newest first, for their settings page. */
export const listBlocked = async (userId) => {
  const rows = await Block.find({ blocker: userId }).sort({ createdAt: -1 }).limit(BLOCK_LIMIT).lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.blocked) } }).select('username displayName avatar').lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return rows
    .filter((r) => byId.has(String(r.blocked)))
    .map((r) => {
      const u = byId.get(String(r.blocked));
      return { userId: String(u._id), username: publicHandle(u), displayName: publicName(u), avatar: u.avatar || '', blockedAt: r.createdAt };
    });
};

/** Removes every block an account made or received (account deletion). */
export const deleteBlocksOf = async (userId) => {
  await Block.deleteMany({ $or: [{ blocker: userId }, { blocked: userId }] });
  cache.delete(String(userId));
  for (const set of cache.values()) set.delete(String(userId));
};

export const _clearBlockCache = () => cache.clear();
