import { TEXT_CATEGORIES } from '../config/texts.js';

/**
 * Input rules for account fields. Kept as plain functions returning an error
 * message (or null) so controllers can answer 400 with a precise reason.
 */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
// Deliberately loose: one @, something on both sides, a dot in the domain.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 6;
// bcrypt ignores bytes past 72; longer inputs only cost hashing time.
export const PASSWORD_MAX = 72;
export const EMAIL_MAX = 254;

export const checkUsername = (username) => {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
    return 'Username must be 3-20 letters, numbers or underscores';
  }
  return null;
};

export const checkEmail = (email) => {
  if (typeof email !== 'string' || email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email.trim())) {
    return 'Enter a valid email address';
  }
  return null;
};

export const checkPassword = (password) => {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters`;
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX) {
    return `Password must be at most ${PASSWORD_MAX} bytes`;
  }
  return null;
};

/** Optional string field: undefined passes, anything else must be a string up to `max`. */
export const checkOptionalString = (value, name, max) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return `${name} must be text`;
  if (value.length > max) return `${name} must be at most ${max} characters`;
  return null;
};

/** Avatar must be an http(s) URL (or empty to clear it). */
export const checkAvatar = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 500) return 'Avatar must be a URL';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? null : 'Avatar must be an http(s) URL';
  } catch {
    return 'Avatar must be a URL';
  }
};

/** IANA zone names only ("Europe/Madrid"); checked against the runtime's list. */
export const checkTimezone = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 64) return 'Invalid timezone';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return null;
  } catch {
    return 'Invalid timezone';
  }
};

export const GAME_MODES = Object.freeze(['phrases', 'words']);
export const WORD_COUNT_MIN = 1;
export const WORD_COUNT_MAX = 500;
export const TIME_MAX_MIN = 5;
export const TIME_MAX_MAX = 600;
// Generated articles (10 paragraphs) run to ~10k characters.
export const CLIENT_TEXT_MAX = 20000;

const isIntIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/**
 * Validates the game settings a client may send (start, reset, refresh,
 * settings, migrate). Absent fields stay absent so callers keep their
 * defaults. Returns `{ error }` or `{ settings }`.
 */
export const parseGameSettings = (body = {}) => {
  const { gameMode, wordCount, timeMax, punctuationEnabled, numbersEnabled, textCategory, clientText, clientTotalWords } = body || {};
  const settings = {};

  if (gameMode !== undefined) {
    if (!GAME_MODES.includes(gameMode)) return { error: 'Invalid game mode' };
    settings.gameMode = gameMode;
  }
  if (wordCount !== undefined) {
    if (!isIntIn(wordCount, WORD_COUNT_MIN, WORD_COUNT_MAX)) return { error: `Word count must be ${WORD_COUNT_MIN}-${WORD_COUNT_MAX}` };
    settings.wordCount = wordCount;
  }
  if (timeMax !== undefined) {
    if (!isIntIn(timeMax, TIME_MAX_MIN, TIME_MAX_MAX)) return { error: `Time limit must be ${TIME_MAX_MIN}-${TIME_MAX_MAX} seconds` };
    settings.timeMax = timeMax;
  }
  if (textCategory !== undefined) {
    if (!TEXT_CATEGORIES.includes(textCategory)) return { error: 'Invalid text category' };
    settings.textCategory = textCategory;
  }
  for (const [name, value] of [['punctuationEnabled', punctuationEnabled], ['numbersEnabled', numbersEnabled]]) {
    if (value === undefined) continue;
    if (typeof value !== 'boolean') return { error: `${name} must be true or false` };
    settings[name] = value;
  }
  if (clientText !== undefined && clientText !== null && clientText !== '') {
    if (typeof clientText !== 'string' || clientText.length > CLIENT_TEXT_MAX || !clientText.trim()) {
      return { error: `Custom text must be 1-${CLIENT_TEXT_MAX} characters` };
    }
    settings.clientText = clientText;
    if (clientTotalWords !== undefined) {
      if (!isIntIn(clientTotalWords, 1, CLIENT_TEXT_MAX)) return { error: 'Invalid word total' };
      settings.clientTotalWords = clientTotalWords;
    }
  }
  return { settings };
};
