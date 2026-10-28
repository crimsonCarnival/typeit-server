/**
 * One-off migration: copies the legacy User.followers/User.following arrays
 * into the Follow collection, sets the denormalised counters from the edges,
 * then removes the arrays. Safe to re-run (edges are upserted and counters
 * recomputed).
 *
 *   MONGO_URI=... node scripts/migrate-follows.js
 */
import mongoose from 'mongoose';
import { MONGO_URI } from '../src/config/env.js';
import Follow from '../src/models/follow.model.js';
import User from '../src/models/user.model.js';

const BATCH = 500;

const run = async () => {
  if (!MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(MONGO_URI);
  await Follow.syncIndexes();

  const users = User.collection;
  const cursor = users.find(
    { $or: [{ following: { $exists: true } }, { followers: { $exists: true } }] },
    { projection: { following: 1, followers: 1 } }
  );

  let ops = [];
  let edges = 0;
  const flush = async () => {
    if (ops.length === 0) return;
    await Follow.bulkWrite(ops, { ordered: false });
    edges += ops.length;
    ops = [];
  };
  const upsert = (follower, followee) => {
    if (String(follower) === String(followee)) return;
    ops.push({
      updateOne: {
        filter: { follower, followee },
        update: { $setOnInsert: { follower, followee, createdAt: new Date() } },
        upsert: true,
      },
    });
  };

  for await (const u of cursor) {
    // Both sides are recorded; an edge present on only one side (a
    // half-applied follow) is still kept.
    for (const followee of u.following ?? []) upsert(u._id, followee);
    for (const follower of u.followers ?? []) upsert(follower, u._id);
    if (ops.length >= BATCH) await flush();
  }
  await flush();

  // Drop edges pointing at accounts that no longer exist.
  const ids = await users.distinct('_id');
  const pruned = await Follow.deleteMany({ $or: [{ follower: { $nin: ids } }, { followee: { $nin: ids } }] });

  // Recompute counters from the edges.
  await users.updateMany({}, { $set: { followersCount: 0, followingCount: 0 } });
  for (const [side, field] of [['followee', 'followersCount'], ['follower', 'followingCount']]) {
    const counts = await Follow.aggregate([{ $group: { _id: `$${side}`, n: { $sum: 1 } } }]);
    if (counts.length) {
      await users.bulkWrite(counts.map((c) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { [field]: c.n } } } })));
    }
  }

  await users.updateMany({}, { $unset: { followers: '', following: '' } });
  console.log(`[migrate-follows] upserted ${edges} edges, pruned ${pruned.deletedCount}`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error('[migrate-follows] failed:', err);
  process.exit(1);
});
