import User from '../models/user.model.js';
import { levelInfo } from '../config/levels.js';
import { notify } from './notification.service.js';

/**
 * Adds XP to a player and tells them when it takes them to a new level.
 * Never throws: failing to award XP must not undo whatever earned it.
 *
 * @param {string|object} userId
 * @param {number} amount  whole points, above zero
 * @returns {Promise<{ before: object, after: object }|null>} levels before and after, or null if nothing was added
 */
export const awardXp = async (userId, amount) => {
  const points = Math.floor(Number(amount) || 0);
  if (points <= 0) return null;
  try {
    const user = await User.findOneAndUpdate({ _id: userId, status: 'active' }, { $inc: { 'stats.xp': points } }, { new: true }).select('stats.xp').lean();
    if (!user) return null;
    const after = levelInfo(user.stats?.xp);
    const before = levelInfo(after.xp - points);
    if (after.level > before.level) {
      await notify(userId, {
        type: 'level-up',
        title: `You reached level ${after.level}`,
        body: `${after.xp.toLocaleString('en-US')} XP so far.`,
        link: '/profile',
        // Reaching the same level twice is impossible, but a retry must not repeat the notice.
        dedupeKey: `level:${after.level}`,
      });
    }
    return { before, after };
  } catch (err) {
    console.error('[xp] could not award XP:', err?.message || err);
    return null;
  }
};
