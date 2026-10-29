import mongoose from 'mongoose';
import User from '../models/user.model.js';
import { ADMIN_USERNAMES, ADMIN_USER_IDS, FOUNDER_USERNAMES, FOUNDER_USER_IDS } from '../config/env.js';

// Usernames are compared ignoring case: the server settings are typed by hand.
const CASE_INSENSITIVE = { locale: 'en', strength: 2 };

/**
 * The accounts a list of ids and usernames stands for. An id is exact. A
 * username that matches more than one account (say "Boss" and "boss") is
 * refused outright rather than guessed at: someone may be impersonating.
 * @returns {Promise<{ ids: string[], refused: string[] }>}
 */
const resolveAccounts = async (userIds, usernames) => {
  const ids = new Set(userIds.map(String));
  const refused = [];
  for (const name of usernames) {
    const matches = await User.find({ username: name }).collation(CASE_INSENSITIVE).select('_id').limit(2).lean();
    if (matches.length === 1) ids.add(String(matches[0]._id));
    else if (matches.length > 1) refused.push(name);
  }
  return { ids: [...ids], refused };
};

/**
 * Gives the accounts named in the server settings their roles. Founders are
 * set (and can only be set) here; admins are only ever promoted, never
 * demoted, so taking a name off the list does not silently strip an account:
 * do that in the admin area.
 *
 * Only existing, active accounts change. A username nobody has registered yet
 * promotes nothing now, but whoever registers it first would be promoted at
 * the next start: use the *_USER_IDS settings (immutable ids) where that matters.
 *
 * @returns {Promise<{ founders: number, admins: number }>} accounts changed
 */
export const applyConfiguredRoles = async ({
  founderIds = FOUNDER_USER_IDS,
  founders = FOUNDER_USERNAMES,
  adminIds = ADMIN_USER_IDS,
  admins = ADMIN_USERNAMES,
} = {}) => {
  // Without a database (local dev with no MONGO_URI) there is nothing to promote.
  if (mongoose.connection.readyState !== 1) return { founders: 0, admins: 0 };
  let founderCount = 0;
  let adminCount = 0;

  if (founderIds.length || founders.length) {
    const { ids, refused } = await resolveAccounts(founderIds, founders);
    for (const name of refused) console.error(`[roles] REFUSED founder "${name}": it matches more than one account. Use FOUNDER_USER_IDS.`);
    if (ids.length) {
      const res = await User.updateMany({ _id: { $in: ids }, role: { $ne: 'founder' }, status: 'active' }, { $set: { role: 'founder' } });
      founderCount = res.modifiedCount ?? 0;
    }
  }
  if (adminIds.length || admins.length) {
    const { ids, refused } = await resolveAccounts(adminIds, admins);
    for (const name of refused) console.error(`[roles] REFUSED admin "${name}": it matches more than one account. Use ADMIN_USER_IDS.`);
    if (ids.length) {
      const res = await User.updateMany({ _id: { $in: ids }, role: { $in: ['user', 'moderator'] }, status: 'active' }, { $set: { role: 'admin' } });
      adminCount = res.modifiedCount ?? 0;
    }
  }
  if (founderCount || adminCount) console.log(`[roles] from settings: ${founderCount} founder(s), ${adminCount} admin(s) promoted`);
  return { founders: founderCount, admins: adminCount };
};
