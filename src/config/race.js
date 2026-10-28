/**
 * Live race configuration. All race timing is decided by the server.
 */
export const RACE_MIN_PLAYERS = 2;
export const RACE_MAX_PLAYERS = 4;
export const RACE_WORD_COUNTS = Object.freeze([25, 50, 75]);
export const RACE_NAME_MAX_LENGTH = 40;

// Countdown once everyone is ready; "Start now" (host) shortens it to the
// delay below so the start message still reaches every player in time.
export const RACE_COUNTDOWN_MS = 5000;
export const RACE_START_NOW_DELAY_MS = 1500;
// A race ends when everyone has finished, or this long after the start;
// anyone still typing is then marked as not finished.
export const RACE_TIMEOUT_MS = 5 * 60 * 1000;
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
