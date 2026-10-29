/**
 * One-time migration: expire the cached changelog so the server's startup
 * timer recompiles it immediately, adding the `day` and `at` fields to every
 * entry (the release notes modal groups entries by the player's local day).
 *
 * Run once after deploying the changelog-lib.js changes that added them:
 *
 *   node scripts/backfill-changelog-days.js
 *
 * The script connects to the same Mongo URI the server uses, sets compiledAt
 * to null, then exits. The server will detect the expired cache within 60
 * seconds of its next start and recompile automatically.
 *
 * If you prefer an immediate recompile without a server restart, use the
 * admin panel → Release Notes → Refresh instead.
 */

import mongoose from 'mongoose';
import { MONGODB_URI } from '../src/config/env.js';

const changelogSchema = new mongoose.Schema(
  { _id: String, releases: mongoose.Schema.Types.Mixed, compiledAt: Date, commits: Number },
  { versionKey: false }
);
const Changelog = mongoose.model('Changelog', changelogSchema);

async function run() {
  await mongoose.connect(MONGODB_URI);
  const result = await Changelog.updateOne({ _id: 'current' }, { $set: { compiledAt: null } });
  if (result.matchedCount === 0) {
    console.log('No changelog document found — nothing to expire.');
  } else {
    console.log('compiledAt set to null. The server will recompile on next startup (within 60 s).');
  }
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });

