import mongoose, { Schema } from 'mongoose';

/**
 * One row per follow edge: `follower` follows `followee`. Replaces the
 * followers/following arrays that used to live on User and grew without
 * bound. Counts are denormalised on User (followersCount/followingCount)
 * and kept in step by services/follow.service.js.
 */
const followSchema = new Schema(
  {
    follower: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    followee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

// Uniqueness, "who do I follow" (newest first) and "who follows me".
followSchema.index({ follower: 1, followee: 1 }, { unique: true });
followSchema.index({ follower: 1, createdAt: -1 });
followSchema.index({ followee: 1, createdAt: -1 });

const Follow = mongoose.model('Follow', followSchema);

export default Follow;
