import mongoose from 'mongoose';
import Notification from '../models/notification.model.js';
import User from '../models/user.model.js';
import { gameEvents } from '../events/game-events.js';

/*
 * In-app notifications: stored in Mongo (the inbox) and pushed live to the
 * player's open sockets through the 'notification' game event (the race
 * socket relays it). Delivery never blocks or fails the action that caused
 * it: notify() swallows its own errors.
 */

// What each type belongs to. Players can mute the optional categories;
// account notices (warnings, bans, role changes, removal from a room) always arrive.
export const CATEGORY_OF = Object.freeze({
  follow: 'social',
  'race-invite': 'social',
  achievement: 'achievements',
  'level-up': 'achievements',
  'race-result': 'races',
  'daily-expiring': 'daily',
  'daily-rank': 'daily',
  account: 'account',
  changelog: 'releases',
});

export const OPTIONAL_CATEGORIES = Object.freeze(['social', 'achievements', 'races', 'daily', 'releases']);

export const isMuted = (prefs, type) => {
  const category = CATEGORY_OF[type];
  return OPTIONAL_CATEGORIES.includes(category) && prefs?.[category] === false;
};

export const toPublic = (n) => ({
  id: String(n._id),
  type: n.type,
  title: n.title,
  body: n.body || '',
  link: n.link || null,
  read: !!n.readAt,
  createdAt: n.createdAt,
});

const push = (userId, doc) => gameEvents.emit('notification', { userId: String(userId), notification: toPublic(doc) });

/**
 * Notifies one player. With `dedupeKey`, the same key never notifies twice.
 * Resolves to the stored notification, or null when it was muted, a repeat, or failed.
 *
 * @param {string|object} userId
 * @param {{ type: string, title: string, body?: string, link?: string|null, dedupeKey?: string|null }} content
 */
export const notify = async (userId, { type, title, body = '', link = null, dedupeKey = null, createdAt = new Date(), live = true, prefs }) => {
  try {
    if (!CATEGORY_OF[type]) throw new Error(`Unknown notification type: ${type}`);
    // Callers that already loaded the player's preferences pass them in.
    const known = prefs !== undefined ? { notificationPrefs: prefs } : await User.findById(userId).select('notificationPrefs').lean();
    if (!known || isMuted(known.notificationPrefs, type)) return null;

    const doc = { _id: new mongoose.Types.ObjectId(), userId, type, title, body, link, dedupeKey, readAt: null, createdAt };
    if (dedupeKey) {
      const res = await Notification.updateOne({ userId, dedupeKey }, { $setOnInsert: doc }, { upsert: true });
      if (!res.upsertedCount) return null;
    } else {
      await Notification.create(doc);
    }
    // A caught-up notice is delivered by the request that found it, not as a live toast.
    if (live) push(userId, doc);
    return doc;
  } catch (err) {
    console.error('[notifications] could not notify:', err?.message || err);
    return null;
  }
};

/**
 * Notifies many players of the same event in bulk (callers have already
 * applied the players' preferences). Returns how many were new.
 */
export const notifyMany = async (userIds, { type, title, body = '', link = null, dedupeKey }) => {
  let created = 0;
  for (let i = 0; i < userIds.length; i += 500) {
    const chunk = userIds.slice(i, i + 500);
    const docs = chunk.map((userId) => ({ _id: new mongoose.Types.ObjectId(), userId, type, title, body, link, dedupeKey, readAt: null, createdAt: new Date() }));
    const res = await Notification.bulkWrite(
      docs.map((doc) => ({ updateOne: { filter: { userId: doc.userId, dedupeKey }, update: { $setOnInsert: doc }, upsert: true } })),
      { ordered: false }
    );
    for (const index of Object.keys(res.upsertedIds || {})) {
      created++;
      push(docs[Number(index)].userId, docs[Number(index)]);
    }
  }
  return created;
};

/** The player's inbox, newest first. `before` is a notification id to page from. */
export const listNotifications = async (userId, { limit = 30, before = null } = {}) => {
  const query = { userId };
  if (before && mongoose.isValidObjectId(before)) {
    const from = await Notification.findOne({ _id: before, userId }).select('createdAt').lean();
    if (from) query.createdAt = { $lt: from.createdAt };
  }
  // By when it happened, which differs from when it was created for caught-up notices.
  const rows = await Notification.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  return rows.map(toPublic);
};

export const unreadCount = (userId) => Notification.countDocuments({ userId, readAt: null });

/** Marks the given notifications read, or all of the player's when `ids` is omitted. */
export const markRead = async (userId, ids = null) => {
  const filter = { userId, readAt: null };
  if (ids) filter._id = { $in: ids.filter((id) => mongoose.isValidObjectId(id)) };
  await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  return unreadCount(userId);
};

export const getPreferences = async (userId) => {
  const user = await User.findById(userId).select('notificationPrefs').lean();
  return Object.fromEntries(OPTIONAL_CATEGORIES.map((c) => [c, user?.notificationPrefs?.[c] !== false]));
};

export const setPreferences = async (userId, patch) => {
  const $set = {};
  for (const c of OPTIONAL_CATEGORIES) if (typeof patch?.[c] === 'boolean') $set[`notificationPrefs.${c}`] = patch[c];
  if (Object.keys($set).length) await User.updateOne({ _id: userId }, { $set });
  return getPreferences(userId);
};
