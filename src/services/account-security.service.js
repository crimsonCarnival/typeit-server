import bcrypt from 'bcryptjs';
import User from '../models/user.model.js';
import { checkEmail, checkPassword } from '../utils/validate.js';
import { USERNAME_PATTERN } from '../utils/public-identity.js';
import { clearRankingsCache } from './ranking.service.js';
import { generateToken } from './auth.service.js';
import { reauthValid } from './google-auth.service.js';
import { notify } from './notification.service.js';

/** How often a player may change their username. */
export const USERNAME_CHANGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const STREAK_OFFSET_MIN = -11;
export const STREAK_OFFSET_MAX = 12;

/** A refused change; `status` is the HTTP status to answer with. */
export class AccountError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const loadWithPassword = async (userId) => {
  const user = await User.findById(userId).select('+password');
  if (!user) throw new AccountError('User not found', 404);
  return user;
};

const passwordMatches = async (user, password) => !!user.password && typeof password === 'string' && (await bcrypt.compare(password, user.password));

/**
 * A sign-in method changed: every other session is signed out (they carry the
 * old token version), the player is told, and this session gets a fresh token.
 * So someone using a stolen session can't quietly keep a way back in.
 */
const methodChanged = async (user, title, body) => {
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  await notify(user._id, { type: 'account', title, body: `${body} Other devices were signed out. If this wasn't you, secure your account now.`, link: '/account?tab=authentication' });
  return generateToken(user);
};

/**
 * Adds a password or changes it. Changing needs the current one; adding one
 * to a Google-only account needs a fresh Google confirmation (`reauth`), since
 * a session alone must not be enough to add a lasting way in.
 * @returns {Promise<string>} a fresh session token
 */
export const setPassword = async (userId, { current, next, reauth }) => {
  const invalid = checkPassword(next);
  if (invalid) throw new AccountError(invalid);
  const user = await loadWithPassword(userId);
  if (user.password) {
    if (!(await passwordMatches(user, current))) throw new AccountError('Current password is wrong', 403);
  } else if (!reauthValid(userId, reauth)) {
    throw new AccountError('Confirm with Google first', 403);
  }
  const adding = !user.password;
  user.password = await bcrypt.hash(next, 10);
  return methodChanged(user, adding ? 'A password was added to your account' : 'Your password was changed', adding ? 'You can now sign in with a password.' : 'Your password is different now.');
};

/**
 * Proves the player behind the session is the owner before an irreversible
 * action (reset, delete): the password, or for a Google-only account a fresh
 * Google confirmation. A stolen session alone must not be able to wipe an account.
 */
export const confirmIdentity = async (userId, { password, reauth }) => {
  const user = await loadWithPassword(userId);
  if (user.password) {
    if (!(await passwordMatches(user, password))) throw new AccountError('Password is wrong', 403);
  } else if (!reauthValid(userId, reauth)) {
    throw new AccountError('Confirm with Google first', 403);
  }
};

/** Linking Google needs the account's password when it has one. */
export const checkCanLinkGoogle = async (userId, password) => {
  const user = await loadWithPassword(userId);
  if (user.password && !(await passwordMatches(user, password))) throw new AccountError('Password is wrong', 403);
};

/** Changes the sign-in email. Needs the password, so an open session alone can't take the account. */
export const setEmail = async (userId, { password, email }) => {
  const invalid = checkEmail(email);
  if (invalid) throw new AccountError(invalid);
  const user = await loadWithPassword(userId);
  if (!user.password) throw new AccountError('Add a password first');
  if (!(await passwordMatches(user, password))) throw new AccountError('Password is wrong', 403);
  const normalized = email.trim().toLowerCase();
  if (await User.exists({ email: normalized, _id: { $ne: userId } })) throw new AccountError('Email already registered', 409);
  user.email = normalized;
  return methodChanged(user, 'Your sign-in email was changed', `It is now ${normalized}.`);
};

/** Removes the Google link, only while a password remains to sign in with. */
export const unlinkGoogle = async (userId) => {
  const user = await loadWithPassword(userId);
  if (!user.googleId) throw new AccountError('Google is not linked');
  if (!user.password) throw new AccountError('Add a password first, or you could not sign in again');
  user.googleId = undefined;
  user.googleEmail = null;
  return methodChanged(user, 'Google sign-in was removed from your account', 'You sign in with your password now.');
};

/** Signs the account out everywhere: every token issued so far stops working. */
export const revokeAllSessions = (userId) => User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });

/** When the player may change their username again, or null if they may now. */
export const nextUsernameChange = (changedAt, now = new Date()) => {
  if (!changedAt) return null;
  const at = new Date(changedAt).getTime() + USERNAME_CHANGE_DAYS * DAY_MS;
  return at > now.getTime() ? new Date(at) : null;
};

/** Changes the username, at most once every USERNAME_CHANGE_DAYS days. */
export const changeUsername = async (userId, username, now = new Date()) => {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) throw new AccountError('Username must be 3-20 letters, numbers, dots, dashes or underscores');
  const user = await User.findById(userId).select('username usernameChangedAt');
  if (!user) throw new AccountError('User not found', 404);
  if (user.username === username) throw new AccountError('That is already your username');
  const wait = nextUsernameChange(user.usernameChangedAt, now);
  if (wait) throw new AccountError(`You can change your username again on ${wait.toISOString().slice(0, 10)}`, 429);
  if (await User.exists({ username, _id: { $ne: userId } })) throw new AccountError('Username already taken', 409);
  await User.updateOne({ _id: userId }, { $set: { username, usernameChangedAt: now } });
};

/** Sets the hour offset streaks use instead of UTC midnight. Only once. */
export const setStreakOffset = async (userId, hours, now = new Date()) => {
  if (!Number.isInteger(hours) || hours < STREAK_OFFSET_MIN || hours > STREAK_OFFSET_MAX) {
    throw new AccountError(`The offset must be a whole number of hours from ${STREAK_OFFSET_MIN} to ${STREAK_OFFSET_MAX}`);
  }
  const res = await User.updateOne({ _id: userId, streakOffsetSetAt: null }, { $set: { streakHourOffset: hours, streakOffsetSetAt: now } });
  if (!res.modifiedCount) throw new AccountError('You have already set your streak offset', 409);
};

/** Takes the player off every leaderboard, for good. */
export const optOutOfLeaderboards = async (userId) => {
  await User.updateOne({ _id: userId }, { $set: { leaderboardOptOut: true } });
  clearRankingsCache();
};

/**
 * Clears the player's personal bests. Their results stay; only results saved
 * after now count towards bests from here on.
 */
export const resetPersonalBests = async (userId, now = new Date()) => {
  const user = await User.findById(userId).select('stats').lean();
  if (!user) throw new AccountError('User not found', 404);
  const unset = { 'stats.highScore': 1, 'stats.bestWpm': 1, 'stats.bestAccuracy': 1 };
  for (const group of ['byTime', 'byWords', 'byMode', 'byModifier']) {
    for (const key of Object.keys(user.stats?.[group] ?? {})) {
      for (const field of ['highScore', 'bestWpm', 'bestAccuracy']) unset[`stats.${group}.${key}.${field}`] = 1;
    }
  }
  await User.updateOne({ _id: userId }, { $unset: unset, $set: { pbResetAt: now } });
};
