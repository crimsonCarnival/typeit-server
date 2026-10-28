import {
  RACE_COUNTDOWN_MS,
  RACE_DEFAULT_MAX_PLAYERS,
  RACE_MAX_PLAYERS,
  RATING_K,
  RACE_MIN_PLAYERS,
  RACE_START_NOW_DELAY_MS,
  RACE_TIMEOUT_MS,
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

export const createRoom = ({ code, host, name, wordCount, isPrivate, maxPlayers = RACE_DEFAULT_MAX_PLAYERS, rated = false, now }) => ({
  code,
  name,
  hostId: host.userId,
  isPrivate: !!isPrivate,
  wordCount,
  maxPlayers: Math.min(Math.max(maxPlayers, 2), RACE_MAX_PLAYERS),
  // Quick-match rooms: results move ratings.
  rated: !!rated,
  state: 'lobby',
  players: [newPlayer(host)],
  spectators: [],
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
  if (findPlayer(room, player.userId)) {
    findPlayer(room, player.userId).connected = true;
    return null;
  }
  if (room.state !== 'lobby' && room.state !== 'countdown') return 'already-started';
  if (room.players.length >= (room.maxPlayers ?? RACE_MAX_PLAYERS)) return 'room-full';
  room.players.push(newPlayer(player));
  // A newcomer isn't ready, so any countdown in progress stops.
  if (room.state === 'countdown') backToLobby(room);
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
    room.startAt = now + RACE_COUNTDOWN_MS;
  } else if (room.state === 'countdown' && !allReady(room)) {
    backToLobby(room);
  }
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
  if (room.state === 'racing' && now >= room.startAt + RACE_TIMEOUT_MS) {
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
  const finishers = room.players
    .filter((p) => p.finishedAt && p.result?.completed)
    .sort((a, b) => a.finishedAt - b.finishedAt);
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
  wordCount: room.wordCount,
  maxPlayers: room.maxPlayers ?? RACE_MAX_PLAYERS,
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
