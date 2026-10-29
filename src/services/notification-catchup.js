import User from '../models/user.model.js';
import Follow from '../models/follow.model.js';
import Race from '../models/race.model.js';
import AuditLog from '../models/audit-log.model.js';
import Notification from '../models/notification.model.js';
import DailyAttempt from '../models/daily-attempt.model.js';
import UserAchievement from '../models/user-achievement.model.js';
import { ACHIEVEMENTS } from '../config/achievements.js';
import { dateKey } from './daily.service.js';
import { rankEntries } from './ranking.service.js';
import { reminderHoursLeft } from './notification-scheduler.js';
import { notify } from './notification.service.js';
import { publicName } from '../utils/public-identity.js';

/*
 * Catch-up: finds what a player should have been told but wasn't, and tells
 * them. It covers events from before notifications existed, and anything the
 * live path missed (server down, a failed write). It runs when the player
 * opens their inbox, at most every few minutes, and looks back a bounded
 * window. Every notice carries the same dedupe key the live path uses, so a
 * player is never told twice about the same thing.
 */

export const CATCHUP_WINDOW_DAYS = 30;
export const CATCHUP_MIN_INTERVAL_MS = 5 * 60 * 1000;
// Per source, so a long-neglected account gets a recent summary, not a flood.
export const CATCHUP_MAX_PER_SOURCE = 20;
// Re-read a little before the last run, in case something landed during it.
const OVERLAP_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_RANK_DAYS = 7;

/** Where to start looking: the last run (with overlap), but never before the window. */
export const lookbackStart = (lastSyncedAt, now) => {
  const floor = now.getTime() - CATCHUP_WINDOW_DAYS * DAY_MS;
  return new Date(lastSyncedAt ? Math.max(new Date(lastSyncedAt).getTime() - OVERLAP_MS, floor) : floor);
};

const AUDIT_ACTIONS = ['user.warn', 'user.role', 'user.ban', 'user.deactivate', 'user.reactivate', 'user.permissions', 'user.profile-reset'];

/** The notice an audit-log entry about a player stands for. */
export const noticeForAudit = (entry) => {
  const why = entry.reason || '';
  switch (entry.action) {
    case 'user.warn': return { title: 'You received a warning', body: why };
    case 'user.role': return { title: `Your role is now ${entry.details?.to ?? 'different'}`, body: '' };
    case 'user.ban': return { title: 'Your account was banned', body: why };
    case 'user.deactivate': return { title: 'Your account was deactivated', body: why };
    case 'user.reactivate': return { title: 'Your account was reactivated', body: why };
    case 'user.permissions': return { title: 'Your permissions changed', body: 'An admin updated what you can do in the admin area.' };
    case 'user.profile-reset': return { title: 'A moderator reset part of your profile', body: `${(entry.details?.fields ?? []).join(', ')}: ${why}` };
    default: return null;
  }
};

const pendingAchievements = async (userId, since) => {
  const unlocks = await UserAchievement.find({ userId, unlockedAt: { $gte: since } }).sort({ unlockedAt: -1 }).limit(CATCHUP_MAX_PER_SOURCE).lean();
  if (!unlocks.length) return [];
  // A batch the live path already announced (as one notice) must not be listed again one by one.
  const earliest = unlocks[unlocks.length - 1].unlockedAt;
  if (await Notification.exists({ userId, type: 'achievement', createdAt: { $gte: new Date(earliest.getTime() - 60_000) } })) return [];

  const named = unlocks.map((u) => ({ at: u.unlockedAt, def: ACHIEVEMENTS.find((a) => a.id === u.achievementId) })).filter((u) => u.def);
  if (named.length > 3) {
    return [{ at: named[0].at, type: 'achievement', title: `You unlocked ${named.length} achievements`, body: named.slice(0, 3).map((u) => u.def.name).join(', ') + ' and more.', link: '/achievements', dedupeKey: `achievements:${named.map((u) => u.def.id).sort().join(',')}` }];
  }
  return named.map(({ at, def }) => ({ at, type: 'achievement', title: `Achievement unlocked: ${def.name}`, body: def.description, link: '/achievements', dedupeKey: `achievement:${def.id}` }));
};

const pendingFollows = async (userId, since) => {
  const follows = await Follow.find({ followee: userId, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(CATCHUP_MAX_PER_SOURCE).populate('follower', 'username displayName status').lean();
  const mine = new Set((await Follow.find({ follower: userId, followee: { $in: follows.map((f) => f.follower?._id) } }).select('followee').lean()).map((f) => String(f.followee)));
  return follows
    .filter((f) => f.follower?.status === 'active')
    .map((f) => {
      const name = publicName(f.follower);
      const mutual = mine.has(String(f.follower._id));
      return {
        at: f.createdAt,
        type: 'follow',
        title: mutual ? `${name} followed you back` : `${name} started following you`,
        body: mutual ? "You're friends now: you can invite each other to races." : '',
        link: `/user/${f.follower._id}`,
        dedupeKey: `follow:${f.follower._id}`,
      };
    });
};

const pendingRaces = async (userId, since) => {
  const races = await Race.find({ 'players.userId': userId, finishedAt: { $gte: since } }).sort({ finishedAt: -1 }).limit(CATCHUP_MAX_PER_SOURCE).lean();
  return races.map((race) => {
    const me = race.players.find((p) => String(p.userId) === String(userId));
    const delta = me?.ratingChange;
    const rating = delta === null || delta === undefined ? '' : ` Rating ${delta >= 0 ? '+' : ''}${delta}.`;
    const name = race.name || race.code;
    return {
      at: race.finishedAt,
      type: 'race-result',
      title: String(race.winnerId) === String(userId) ? `You won "${name}"` : me?.place ? `You placed #${me.place} in "${name}"` : `You didn't finish "${name}"`,
      body: me?.wpm ? `${me.wpm} WPM at ${Math.round(me.accuracy)}% accuracy.${rating}` : rating.trim(),
      link: '/profile',
      dedupeKey: `race:${race._id}`,
    };
  });
};

const pendingDailyRanks = async (userId, since, now) => {
  const today = dateKey(now);
  const mine = await DailyAttempt.find({ userId, ranked: true, date: { $lt: today, $gte: dateKey(new Date(Math.max(since.getTime(), now.getTime() - DAILY_RANK_DAYS * DAY_MS))) } })
    .sort({ date: -1 })
    .limit(DAILY_RANK_DAYS)
    .lean();
  const notices = [];
  for (const attempt of mine) {
    const all = await DailyAttempt.find({ date: attempt.date, ranked: true }).select('userId wpm accuracy finishedAt').lean();
    const ranked = rankEntries(all.map((a) => ({ userId: String(a.userId), wpm: a.wpm, accuracy: a.accuracy, achievedAt: a.finishedAt })));
    const entry = ranked.find((e) => e.userId === String(userId));
    if (!entry) continue;
    notices.push({
      at: new Date(`${attempt.date}T23:59:59Z`),
      type: 'daily-rank',
      title: entry.rank === 1 ? `You won the ${attempt.date} daily challenge!` : `You placed #${entry.rank} in the ${attempt.date} daily`,
      body: `${entry.wpm} WPM at ${Math.round(entry.accuracy)}% accuracy, out of ${ranked.length} ranked ${ranked.length === 1 ? 'player' : 'players'}.`,
      link: '/daily',
      dedupeKey: `daily-rank:${attempt.date}`,
    });
  }
  return notices;
};

const pendingAudit = async (userId, since) => {
  const entries = await AuditLog.find({ targetId: userId, action: { $in: AUDIT_ACTIONS }, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(CATCHUP_MAX_PER_SOURCE).lean();
  return entries.flatMap((e) => {
    const notice = noticeForAudit(e);
    return notice ? [{ at: e.createdAt, type: 'account', ...notice, link: null, dedupeKey: `audit:${e._id}` }] : [];
  });
};

/** Today's daily is nearly over and the player hasn't started it. */
const pendingDailyReminder = async (userId, now) => {
  const hours = reminderHoursLeft(now);
  if (hours === null) return [];
  const date = dateKey(now);
  if (await DailyAttempt.exists({ userId, date })) return [];
  return [{
    at: now,
    type: 'daily-expiring',
    title: "Today's daily challenge is about to expire",
    body: hours === 1 ? 'Less than an hour left to play it.' : `About ${hours} hours left to play it.`,
    link: '/daily',
    dedupeKey: `daily-expiring:${date}`,
  }];
};

/**
 * Notifies the player of everything pending. Notices are created oldest first,
 * so the inbox order follows the order things happened. Returns how many were new.
 */
export const catchUpNotifications = async (userId, now = new Date()) => {
  const user = await User.findById(userId).select('notificationsSyncedAt notificationPrefs status').lean();
  if (!user || user.status !== 'active') return 0;
  if (user.notificationsSyncedAt && now.getTime() - new Date(user.notificationsSyncedAt).getTime() < CATCHUP_MIN_INTERVAL_MS) return 0;

  const since = lookbackStart(user.notificationsSyncedAt, now);
  const pending = (
    await Promise.all([
      pendingAchievements(userId, since),
      pendingFollows(userId, since),
      pendingRaces(userId, since),
      pendingDailyRanks(userId, since, now),
      pendingAudit(userId, since),
      pendingDailyReminder(userId, now),
    ])
  )
    .flat()
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  let created = 0;
  for (const { at, ...content } of pending) {
    // The request that found it delivers it: no live toast for something that already happened.
    if (await notify(userId, { ...content, createdAt: new Date(at), live: false, prefs: user.notificationPrefs })) created++;
  }
  await User.updateOne({ _id: userId }, { $set: { notificationsSyncedAt: now } });
  return created;
};
