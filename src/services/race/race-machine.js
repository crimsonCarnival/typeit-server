import {
  RACE_CATEGORIES,
  RACE_COUNTDOWN_OPTIONS,
  RACE_DEFAULT_SETTINGS,
  RATING_K,
  RACE_MIN_PLAYERS,
  RACE_MODES,
  RACE_PLAYER_LIMITS,
  RACE_START_NOW_DELAY_MS,
  RACE_TIMED_GRACE_MS,
  RACE_TIMEOUT_MS,
  RACE_TIME_LIMITS,
  RACE_WORD_COUNTS,
} from '../../config/race.js';

/**
 * Race state machine. Pure: every function takes the room (and `now`) and
 * mutates the room in place, returning an error code string when the action
 * isn't allowed, or null. No I/O, so the rules are unit-testable; the race
 * manager does sockets, timers and persistence.
 *
 *   lobby ──all ready (≥2)──▶ countdown ──startAt reached──▶ racing ──all done / timeout──▶ finished
 *     ▲                          │
 *     └── someone unreadies, leaves or cancels
 */

/**
 * Validates host-chosen settings against the allowed values. Missing fields
 * fall back to `base`. Returns the full settings object, or null if any
 * provided value isn't allowed.
 */
export const normalizeSettings = (input = {}, base = RACE_DEFAULT_SETTINGS) => {
  const s = { ...base };
  const pick = (key, allowed) => {
    if (input[key] === undefined) return true;
    if (!allowed.includes(input[key])) return false;
    s[key] = input[key];
    return true;
  };
  const ok =
    pick('mode', RACE_MODES) &&
    pick('category', RACE_CATEGORIES) &&
    pick('wordCount', RACE_WORD_COUNTS) &&
    pick('timeLimit', RACE_TIME_LIMITS) &&
    pick('maxPlayers', RACE_PLAYER_LIMITS) &&
    pick('countdownSec', RACE_COUNTDOWN_OPTIONS) &&
    pick('punctuation', [true, false]) &&
    pick('numbers', [true, false]);
  return ok ? s : null;
};

const countdownMs = (room) => room.countdownSec * 1000;
const raceTimeoutMs = (room) => (room.mode === 'time' ? room.timeLimit * 1000 + RACE_TIMED_GRACE_MS : RACE_TIMEOUT_MS);

export const createRoom = ({ code, host, name, isPrivate, rated = false, now, ...settings }) => ({
  code,
  name,
  hostId: host.userId,
  isPrivate: !!isPrivate,
  ...normalizeSettings(settings),
  // Quick-match rooms: results move ratings.
  rated: !!rated,
  state: 'lobby',
  players: [newPlayer(host)],
  spectators: [],
  // Players the host kicked: they can't join or watch this room again.
  banned: [],
  text: null,
  startAt: null,
  finishedAt: null,
  winnerId: null,
  updatedAt: now,
});

const newPlayer = ({ userId, username, displayName, avatar, rating = null }) => ({
  userId,
  username,
  displayName: displayName || username,
  avatar: avatar || '',
  rating,
  ready: false,
  connected: true,
  index: 0,
  wpm: 0,
  accuracy: 100,
  finishedAt: null,
  result: null, // { wpm, accuracy, ranked, resultId }
  place: null,
});

export const findPlayer = (room, userId) => room.players.find((p) => p.userId === userId) ?? null;

const allReady = (room) => room.players.length >= RACE_MIN_PLAYERS && room.players.every((p) => p.ready);

// Nobody left who could still finish: everyone finished or disconnected.
const nobodyStillRacing = (room) => room.players.every((p) => p.finishedAt || !p.connected);

const backToLobby = (room) => {
  room.state = 'lobby';
  room.startAt = null;
  room.text = null;
};

export const joinRoom = (room, player, now) => {
  if (isBanned(room, player.userId)) return 'banned';
  if (findPlayer(room, player.userId)) {
    findPlayer(room, player.userId).connected = true;
    return null;
  }
  if (room.state !== 'lobby' && room.state !== 'countdown') return 'already-started';
  if (room.players.length >= room.maxPlayers) return 'room-full';
  room.players.push(newPlayer(player));
  // A newcomer isn't ready, so any countdown in progress stops.
  if (room.state === 'countdown') backToLobby(room);
  room.updatedAt = now;
  return null;
};

export const isBanned = (room, userId) => !!room.banned?.includes(userId);

/**
 * Host removes a player and bars them from the room for good (kept across
 * rematches). Not during a race, and not in rated quick matches, whose host
 * is just whoever was matched first.
 */
export const kickPlayer = (room, hostId, targetId, now) => {
  if (room.hostId !== hostId) return 'not-host';
  if (targetId === hostId) return 'cannot-kick-self';
  if (room.rated) return 'rated-room';
  if (room.state === 'racing') return 'already-started';
  if (!findPlayer(room, targetId)) return 'not-in-room';
  room.players = room.players.filter((p) => p.userId !== targetId);
  if (!room.banned.includes(targetId)) room.banned.push(targetId);
  // The countdown survives as long as everyone still there is ready.
  if (room.state === 'countdown' && !allReady(room)) backToLobby(room);
  room.updatedAt = now;
  return null;
};

/**
 * Removes a player before the race, or marks them disconnected during it
 * (they keep their lane and can reconnect). Returns whether the room is now
 * empty and whether this ended the race (the last racer left).
 */
export const leaveRoom = (room, userId, now) => {
  const player = findPlayer(room, userId);
  if (!player) return { empty: room.players.length === 0, finished: false };
  let finished = false;

  if (room.state === 'lobby' || room.state === 'countdown') {
    room.players = room.players.filter((p) => p.userId !== userId);
    if (room.hostId === userId && room.players.length) room.hostId = room.players[0].userId;
    // The countdown survives as long as everyone still there is ready.
    if (room.state === 'countdown' && !allReady(room)) backToLobby(room);
  } else {
    player.connected = false;
    if (room.state === 'racing' && nobodyStillRacing(room)) {
      finishRace(room, now);
      finished = true;
    }
  }
  room.updatedAt = now;
  return { empty: room.players.length === 0 || room.players.every((p) => !p.connected), finished };
};

/** Readying the last player starts the countdown; unreadying stops it. */
export const setReady = (room, userId, ready, now) => {
  const player = findPlayer(room, userId);
  if (!player) return 'not-in-room';
  if (room.state !== 'lobby' && room.state !== 'countdown') return 'already-started';
  player.ready = !!ready;
  room.updatedAt = now;

  if (room.state === 'lobby' && allReady(room)) {
    room.state = 'countdown';
    room.startAt = now + countdownMs(room);
  } else if (room.state === 'countdown' && !allReady(room)) {
    backToLobby(room);
  }
  return null;
};

/**
 * Host changes the race settings before it starts. Everyone is unreadied (the
 * race they agreed to changed), which also stops a running countdown.
 */
export const updateSettings = (room, userId, input, now) => {
  if (room.hostId !== userId) return 'not-host';
  // Rated (quick-match) rooms keep their fixed rules; changing them would let a host steer ratings.
  if (room.rated) return 'rated-room';
  if (room.state !== 'lobby' && room.state !== 'countdown') return 'already-started';
  const next = normalizeSettings(input, room);
  if (!next) return 'bad-settings';
  if (room.players.length > next.maxPlayers) return 'too-many-players';
  const { mode, category, wordCount, timeLimit, maxPlayers, countdownSec, punctuation, numbers } = next;
  Object.assign(room, { mode, category, wordCount, timeLimit, maxPlayers, countdownSec, punctuation, numbers });
  room.players.forEach((p) => { p.ready = false; });
  backToLobby(room);
  room.updatedAt = now;
  return null;
};

/** "Cancel to keep waiting": the canceller unreadies, which stops the countdown. */
export const cancelCountdown = (room, userId, now) => {
  if (room.state !== 'countdown') return 'not-counting-down';
  return setReady(room, userId, false, now);
};

/** Host skips the rest of the countdown. */
export const startNow = (room, userId, now) => {
  if (room.hostId !== userId) return 'not-host';
  if (room.state !== 'countdown') return 'not-counting-down';
  room.startAt = Math.min(room.startAt, now + RACE_START_NOW_DELAY_MS);
  room.updatedAt = now;
  return null;
};

/**
 * Advances time-based transitions. Returns 'started', 'finished' or null so
 * the manager knows what side effects to run.
 */
export const tick = (room, now) => {
  if (room.state === 'countdown' && now >= room.startAt) {
    room.state = 'racing';
    room.updatedAt = now;
    return 'started';
  }
  if (room.state === 'racing' && now >= room.startAt + raceTimeoutMs(room)) {
    finishRace(room, now);
    return 'finished';
  }
  return null;
};

/**
 * Live progress for the lanes. WPM is computed from the server's clock, not
 * taken from the client. Only display data: final results come from the
 * player's saved run.
 */
export const updateProgress = (room, userId, { index, accuracy }, now) => {
  const player = findPlayer(room, userId);
  if (!player) return 'not-in-room';
  if (room.state !== 'racing' || player.finishedAt) return 'not-racing';
  if (!Number.isInteger(index) || index < 0) return 'bad-progress';

  player.index = Math.min(index, room.text.length);
  const minutes = Math.max((now - room.startAt) / 60000, 1 / 60);
  player.wpm = Math.round(player.index / 5 / minutes);
  if (Number.isFinite(accuracy)) player.accuracy = Math.min(100, Math.max(0, Math.round(accuracy)));
  room.updatedAt = now;
  return null;
};

/**
 * Records a player's finished, server-assessed run. Ends the race once no
 * connected player is still typing. A run that didn't complete the text
 * (e.g. submitted early) ends that player's race as did-not-finish: it can't
 * place or win.
 * @returns {string|null|'finished'}
 */
export const recordFinish = (room, userId, result, now) => {
  const player = findPlayer(room, userId);
  if (!player) return 'not-in-room';
  if (room.state !== 'racing') return 'not-racing';
  if (player.finishedAt) return 'already-finished';

  player.finishedAt = now;
  player.result = result;
  if (result.completed) player.index = room.text.length;
  player.wpm = result.wpm;
  player.accuracy = result.accuracy;
  room.updatedAt = now;

  if (nobodyStillRacing(room)) {
    finishRace(room, now);
    return 'finished';
  }
  return null;
};

/**
 * Places finishers by finish time; non-finishers get no place. The winner is
 * the first finisher whose run passed the integrity checks: an unverified
 * run can place but never wins.
 */
export const finishRace = (room, now) => {
  room.state = 'finished';
  room.finishedAt = now;
  // Timed races rank by speed; word races by who crossed the line first.
  const byOrder = room.mode === 'time'
    ? (a, b) => b.result.wpm - a.result.wpm || a.finishedAt - b.finishedAt
    : (a, b) => a.finishedAt - b.finishedAt;
  const finishers = room.players
    .filter((p) => p.finishedAt && p.result?.completed)
    .sort(byOrder);
  finishers.forEach((p, i) => { p.place = i + 1; });
  room.winnerId = finishers.find((p) => p.result?.ranked)?.userId ?? null;
};

/**
 * Rematch: a finished room goes back to the lobby with the same settings and
 * the players still connected. Ratings and places start afresh.
 */
export const resetForRematch = (room, userId, now) => {
  if (room.state !== 'finished') return 'not-finished';
  if (!findPlayer(room, userId)) return 'not-in-room';
  room.players = room.players
    .filter((p) => p.connected)
    // Ratings carry the last race's change into the rematch.
    .map((p) => newPlayer({ ...p, rating: p.rating == null ? null : p.rating + (room.ratingChanges?.[p.userId] ?? 0) }));
  if (!findPlayer(room, room.hostId)) room.hostId = room.players[0]?.userId ?? userId;
  room.state = 'lobby';
  room.text = null;
  room.startAt = null;
  room.finishedAt = null;
  room.winnerId = null;
  room.ratingChanges = null;
  room.updatedAt = now;
  return null;
};

/**
 * Rating changes for a rated race. Every pair of racers is one Elo game:
 * a verified finisher beats anyone placed after them or who didn't finish
 * with a verified run; two non-finishers draw. K is shared out over the
 * opponents so a bigger room doesn't swing ratings more. Pure.
 *
 * @param {Array<{userId:string, rating:number, place:number|null, verified:boolean}>} racers
 * @returns {Map<string, number>} userId -> rating change (rounded)
 */
export const ratingChanges = (racers) => {
  const changes = new Map(racers.map((r) => [r.userId, 0]));
  if (racers.length < 2) return changes;
  const k = RATING_K / (racers.length - 1);
  // Unverified runs count as not finishing: rating can't be won with them.
  const rank = (r) => (r.verified && r.place ? r.place : Infinity);
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i];
      const b = racers[j];
      const expectedA = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));
      const scoreA = rank(a) < rank(b) ? 1 : rank(a) > rank(b) ? 0 : 0.5;
      const delta = k * (scoreA - expectedA);
      changes.set(a.userId, changes.get(a.userId) + delta);
      changes.set(b.userId, changes.get(b.userId) - delta);
    }
  }
  for (const [id, d] of changes) changes.set(id, Math.round(d));
  return changes;
};

/** What a client may see. The text is withheld until the race starts. */
export const publicRoom = (room, now) => ({
  code: room.code,
  name: room.name,
  hostId: room.hostId,
  isPrivate: room.isPrivate,
  mode: room.mode,
  category: room.category,
  wordCount: room.wordCount,
  timeLimit: room.timeLimit,
  maxPlayers: room.maxPlayers,
  countdownSec: room.countdownSec,
  punctuation: room.punctuation,
  numbers: room.numbers,
  rated: !!room.rated,
  spectators: room.spectators?.length ?? 0,
  state: room.state,
  startAt: room.startAt,
  serverNow: now,
  text: room.state === 'racing' || room.state === 'finished' ? room.text : null,
  winnerId: room.winnerId,
  players: room.players.map(({ result, ...p }) => ({ ...p, ranked: result ? !!result.ranked : null })),
  // Rating changes once a rated race is over (userId -> delta).
  ratingChanges: room.ratingChanges ?? null,
});
