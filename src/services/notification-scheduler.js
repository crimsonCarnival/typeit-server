import User from '../models/user.model.js';
import DailyAttempt from '../models/daily-attempt.model.js';
import DailyChallenge from '../models/daily-challenge.model.js';
import { dateKey, nextResetAt, previousDates } from './daily.service.js';
import { rankEntries } from './ranking.service.js';
import { notify, notifyMany } from './notification.service.js';

// Remind players who haven't played today's daily when this little is left of the day.
export const DAILY_REMINDER_HOURS = 3;
// Only players who were around recently get the reminder.
export const ACTIVE_WINDOW_DAYS = 30;
export const SCHEDULER_TICK_MS = 10 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Whole hours (rounded up) until the daily resets, or null when it is not yet time to remind. */
export const reminderHoursLeft = (now) => {
  const left = nextResetAt(now).getTime() - now.getTime();
  return left <= DAILY_REMINDER_HOURS * HOUR_MS ? Math.max(1, Math.ceil(left / HOUR_MS)) : null;
};

/**
 * "Today's daily is about to expire" for recently active players who haven't
 * started it. One reminder per player per day (the key carries the date), so
 * running this every few minutes is safe.
 * @returns {Promise<number>} reminders sent
 */
export const sendDailyReminders = async (now = new Date()) => {
  const hours = reminderHoursLeft(now);
  if (hours === null) return 0;
  const date = dateKey(now);

  const [players, started] = await Promise.all([
    User.find({
      status: 'active',
      lastSessionAt: { $gte: new Date(now.getTime() - ACTIVE_WINDOW_DAYS * DAY_MS) },
      'notificationPrefs.daily': { $ne: false },
    }).select('_id').lean(),
    DailyAttempt.distinct('userId', { date }),
  ]);
  const done = new Set(started.map(String));
  const ids = players.map((p) => p._id).filter((id) => !done.has(String(id)));
  if (!ids.length) return 0;

  return notifyMany(ids, {
    type: 'daily-expiring',
    title: "Today's daily challenge is about to expire",
    body: hours === 1 ? 'Less than an hour left to play it.' : `About ${hours} hours left to play it.`,
    link: '/daily',
    dedupeKey: `daily-expiring:${date}`,
  });
};

/**
 * Tells everyone with a ranked run on yesterday's daily where they placed.
 * Idempotent: the dedupe key carries the date, and the day is marked done.
 * @returns {Promise<number>} notifications sent
 */
export const sendDailyResults = async (now = new Date()) => {
  const [date] = previousDates(dateKey(now), 1);
  const challenge = await DailyChallenge.findOne({ date }).select('resultsNotifiedAt').lean();
  if (!challenge || challenge.resultsNotifiedAt) return 0;

  const attempts = await DailyAttempt.find({ date, ranked: true }).select('userId wpm accuracy finishedAt').lean();
  const ranked = rankEntries(attempts.map((a) => ({ userId: String(a.userId), wpm: a.wpm, accuracy: a.accuracy, achievedAt: a.finishedAt })));
  let sent = 0;
  for (const entry of ranked) {
    const won = entry.rank === 1;
    const made = await notify(entry.userId, {
      type: 'daily-rank',
      title: won ? 'You won yesterday\'s daily challenge!' : `You placed #${entry.rank} in yesterday's daily`,
      body: `${entry.wpm} WPM at ${Math.round(entry.accuracy)}% accuracy, out of ${ranked.length} ranked ${ranked.length === 1 ? 'player' : 'players'}.`,
      link: '/daily',
      dedupeKey: `daily-rank:${date}`,
    });
    if (made) sent++;
  }
  await DailyChallenge.updateOne({ date }, { $set: { resultsNotifiedAt: now } });
  return sent;
};

const tick = async () => {
  await sendDailyReminders();
  await sendDailyResults();
};

/** Starts the periodic job. Unref'd so it never keeps the process alive. */
export const startNotificationScheduler = () => {
  const run = () => tick().catch((err) => console.error('[notifications] scheduler:', err?.message || err));
  setTimeout(run, 30_000).unref();
  setInterval(run, SCHEDULER_TICK_MS).unref();
};
