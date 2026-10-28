/**
 * Live race configuration. All race timing is decided by the server.
 */
export const RACE_MIN_PLAYERS = 2;
export const RACE_MAX_PLAYERS = 8;
export const RACE_DEFAULT_MAX_PLAYERS = 4;
export const RACE_PLAYER_LIMITS = Object.freeze([2, 3, 4, 6, 8]);

// Race modes: `words` ends when you've typed the whole text (first across the
// line wins); `time` gives everyone the same clock and the highest WPM wins.
export const RACE_MODES = Object.freeze(['words', 'time']);
export const RACE_WORD_COUNTS = Object.freeze([10, 25, 50, 75, 100, 150, 200, 300, 400, 500]);
export const RACE_TIME_LIMITS = Object.freeze([15, 30, 60, 120, 180, 300, 600]);
// Timed races need more text than anyone can type; this many words per second
// of the limit is above any human pace.
export const RACE_TIMED_WORDS_PER_SECOND = 4;
export const RACE_COUNTDOWN_OPTIONS = Object.freeze([3, 5, 10, 15]);
export const RACE_NAME_MAX_LENGTH = 40;

// Countdown once everyone is ready; "Start now" (host) shortens it to the
// delay below so the start message still reaches every player in time.
export const RACE_COUNTDOWN_MS = 5000;
export const RACE_DEFAULT_SETTINGS = Object.freeze({
  mode: 'words',
  wordCount: 25,
  timeLimit: 30,
  maxPlayers: RACE_DEFAULT_MAX_PLAYERS,
  countdownSec: RACE_COUNTDOWN_MS / 1000,
  punctuation: false,
  numbers: false,
});
export const RACE_START_NOW_DELAY_MS = 1500;
// A race ends when everyone has finished, or this long after the start;
// anyone still typing is then marked as not finished.
export const RACE_TIMEOUT_MS = 5 * 60 * 1000;
// Timed races stop at the limit; slack for the last results to arrive.
export const RACE_TIMED_GRACE_MS = 8000;
// A timed run counts as lasting the clock if it ended within this many seconds
// of the limit (client and server clocks differ a little).
export const RACE_TIMED_FINISH_TOLERANCE_S = 2;
// Lobbies nobody touches for this long are closed.
export const RACE_LOBBY_IDLE_MS = 30 * 60 * 1000;
// Finished rooms stay around briefly so players can read the standings.
export const RACE_FINISHED_TTL_MS = 2 * 60 * 1000;

// Invite codes: TYPE-XXXX without easily confused characters (0/O, 1/I/L).
export const RACE_CODE_PREFIX = 'TYPE-';
export const RACE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const RACE_CODE_LENGTH = 4;

// WebSocket hygiene
export const RACE_SOCKET_PATH = '/ws/race';
export const RACE_MAX_MESSAGE_BYTES = 4096;
export const RACE_AUTH_TIMEOUT_MS = 5000;
// Messages beyond this rate (per socket, per second) are dropped.
export const RACE_MAX_MESSAGES_PER_SECOND = 30;
export const RACE_INVITE_COOLDOWN_MS = 10_000;
// Private rooms are protected by their code (~923k combinations). Failed
// joins are limited per user across all their sockets, which makes guessing
// a code impractical (10/min is ~64 days per account to cover the space).
export const RACE_MAX_FAILED_JOINS_PER_MINUTE = 10;
export const RACE_MAX_SOCKETS_PER_USER = 3;
export const RACE_TICK_MS = 250;

// Quick match: queued players are put in a rated public room once enough
// are waiting, or once the first has waited long enough and there are two.
export const QUICK_MATCH_WORD_COUNT = 50;
export const QUICK_MATCH_MAX_PLAYERS = 6;
export const QUICK_MATCH_WAIT_MS = 5000;
// Players further apart than this in rating only meet after waiting longer.
export const QUICK_MATCH_RATING_SPREAD = 300;
export const QUICK_MATCH_WIDEN_AFTER_MS = 20_000;

// Race rating (Elo over every pair of racers in a rated room).
export const RATING_START = 1000;
export const RATING_K = 32;

// Spectators per room.
export const RACE_MAX_SPECTATORS = 20;

// Chat: short messages, one per CHAT_COOLDOWN_MS per user; emotes from a fixed set.
export const CHAT_MAX_LENGTH = 140;
export const CHAT_COOLDOWN_MS = 1000;
// Recent lines kept per room so people who join later can catch up.
export const CHAT_HISTORY_LIMIT = 30;
export const RACE_EMOTES = Object.freeze(['wave', 'fire', 'laugh', 'wow', 'clap', 'gg']);
