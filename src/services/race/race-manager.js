import crypto from 'crypto';
import mongoose from 'mongoose';
import Race from '../../models/race.model.js';
import User from '../../models/user.model.js';
import { gameEvents } from '../../events/game-events.js';
import { generateText, startRaceSession } from '../game.service.js';
import { syncAchievements } from '../achievement.service.js';
import {
  RACE_CODE_ALPHABET,
  RACE_CODE_LENGTH,
  RACE_CODE_PREFIX,
  RACE_FINISHED_TTL_MS,
  RACE_INVITE_COOLDOWN_MS,
  RACE_LOBBY_IDLE_MS,
  RACE_MAX_FAILED_JOINS_PER_MINUTE,
  RACE_MAX_SOCKETS_PER_USER,
  RACE_MIN_PLAYERS,
  RACE_NAME_MAX_LENGTH,
  RACE_TICK_MS,
  RACE_TIMED_WORDS_PER_SECOND,
} from '../../config/race.js';
import {
  cancelCountdown,
  createRoom,
  findPlayer,
  joinRoom,
  leaveRoom,
  normalizeSettings,
  publicRoom,
  recordFinish,
  setReady,
  startNow,
  tick,
  updateProgress,
  updateSettings,
} from './race-machine.js';

/**
 * Live race rooms. State lives in this process's memory: fine for one server
 * instance (the current Render setup). A restart drops open rooms; finished
 * races are persisted. Scaling to several instances would need a shared
 * store (e.g. Redis) and sticky sessions.
 */
const rooms = new Map(); // code -> room
const roomOf = new Map(); // userId -> code
const sockets = new Map(); // userId -> Set<ws>
const lastInvite = new Map(); // `${from}|${to}` -> ms
const failedJoins = new Map(); // userId -> timestamps of recent failed joins (per user, not per socket)

const tooManyFailedJoins = (userId, now) => {
  const recent = (failedJoins.get(userId) ?? []).filter((t) => now - t < 60_000);
  failedJoins.set(userId, recent);
  return recent.length >= RACE_MAX_FAILED_JOINS_PER_MINUTE;
};

const send = (ws, msg) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
};

const sendTo = (userId, msg) => {
  for (const ws of sockets.get(userId) ?? []) send(ws, msg);
};

const broadcast = (room, now = Date.now()) => {
  const view = publicRoom(room, now);
  for (const p of room.players) sendTo(p.userId, { type: 'room', room: view });
};

const error = (userId, code) => sendTo(userId, { type: 'error', code });

export const isOnline = (userId) => (sockets.get(String(userId))?.size ?? 0) > 0;

const newCode = () => {
  for (;;) {
    let code = RACE_CODE_PREFIX;
    for (let i = 0; i < RACE_CODE_LENGTH; i++) code += RACE_CODE_ALPHABET[crypto.randomInt(RACE_CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
};

/**
 * Takes a player out of their room. A dropped connection mid-race keeps the
 * mapping so a reconnect lands back in the same lane.
 */
const detach = (userId, now, { reconnectable = false } = {}) => {
  const code = roomOf.get(userId);
  const room = code && rooms.get(code);
  if (!room) {
    roomOf.delete(userId);
    return;
  }
  if (!(reconnectable && room.state === 'racing')) roomOf.delete(userId);
  const { empty, finished } = leaveRoom(room, userId, now);
  if (finished) void persistRace(room);
  if (empty && room.state !== 'racing') rooms.delete(code);
  else broadcast(room, now);
};

/** Mutual follows count as friends (who can invite each other). */
const areFriends = async (a, b) => {
  const user = await User.findById(a).select('following followers').lean();
  const has = (list) => (list ?? []).some((id) => String(id) === String(b));
  return !!user && has(user.following) && has(user.followers);
};

// ---------------------------------------------------------------- actions

const actions = {
  create(user, { name, isPrivate, ...settings }, now) {
    if (!normalizeSettings(settings)) return error(user.userId, 'bad-settings');
    const roomName = typeof name === 'string' ? name.trim().slice(0, RACE_NAME_MAX_LENGTH) : '';
    detach(user.userId, now);
    const room = createRoom({ code: newCode(), host: user, name: roomName || `${user.displayName}'s race`, isPrivate, now, ...settings });
    rooms.set(room.code, room);
    roomOf.set(user.userId, room.code);
    broadcast(room, now);
  },

  join(user, { code }, now) {
    if (tooManyFailedJoins(user.userId, now)) return error(user.userId, 'too-many-attempts');
    const room = typeof code === 'string' && rooms.get(code.trim().toUpperCase());
    if (!room) {
      failedJoins.get(user.userId).push(now);
      return error(user.userId, 'room-not-found');
    }
    if (roomOf.get(user.userId) !== room.code) detach(user.userId, now);
    const err = joinRoom(room, user, now);
    if (err) return error(user.userId, err);
    roomOf.set(user.userId, room.code);
    broadcast(room, now);
  },

  settings(user, { type: _type, ...settings }, now) {
    withRoom(user, (room) => updateSettings(room, user.userId, settings, now), now);
  },

  leave(user, _msg, now) {
    detach(user.userId, now);
    sendTo(user.userId, { type: 'left' });
  },

  ready(user, { ready }, now) {
    withRoom(user, (room) => setReady(room, user.userId, ready === true, now), now);
  },

  cancel(user, _msg, now) {
    withRoom(user, (room) => cancelCountdown(room, user.userId, now), now);
  },

  startNow(user, _msg, now) {
    withRoom(user, (room) => startNow(room, user.userId, now), now);
  },

  progress(user, { index, accuracy }, now) {
    const room = rooms.get(roomOf.get(user.userId));
    // Progress is frequent; failures are silently dropped.
    if (room && !updateProgress(room, user.userId, { index, accuracy }, now)) broadcast(room, now);
  },

  async invite(user, { userId: target }) {
    if (typeof target !== 'string' || !mongoose.isValidObjectId(target)) return error(user.userId, 'bad-invite');
    const code = roomOf.get(user.userId);
    const room = code && rooms.get(code);
    if (!room || room.state !== 'lobby') return error(user.userId, 'not-in-lobby');
    const key = `${user.userId}|${target}`;
    if (Date.now() - (lastInvite.get(key) ?? 0) < RACE_INVITE_COOLDOWN_MS) return error(user.userId, 'invite-cooldown');
    if (!isOnline(target)) return error(user.userId, 'friend-offline');
    if (!(await areFriends(user.userId, target))) return error(user.userId, 'not-friends');
    lastInvite.set(key, Date.now());
    sendTo(target, {
      type: 'invited',
      code: room.code,
      name: room.name,
      from: { userId: user.userId, displayName: user.displayName, username: user.username },
    });
    sendTo(user.userId, { type: 'invite-sent', userId: target });
  },

  list(user) {
    const open = [...rooms.values()]
      .filter((r) => !r.isPrivate && r.state === 'lobby')
      .map((r) => ({
        code: r.code,
        name: r.name,
        mode: r.mode,
        wordCount: r.wordCount,
        timeLimit: r.timeLimit,
        maxPlayers: r.maxPlayers,
        players: r.players.length,
      }));
    sendTo(user.userId, { type: 'rooms', rooms: open });
  },
};

// Timed races get more text than anyone can finish before the clock runs out.
const textWords = (room) => (room.mode === 'time' ? room.timeLimit * RACE_TIMED_WORDS_PER_SECOND : room.wordCount);

function withRoom(user, fn, now) {
  const room = rooms.get(roomOf.get(user.userId));
  if (!room) return error(user.userId, 'not-in-room');
  const err = fn(room);
  if (err) return error(user.userId, err);
  if (room.state === 'countdown' && !room.text) {
    // Pick the text as the countdown starts; it is only revealed at startAt.
    room.text = generateText('words', textWords(room), room.punctuation, room.numbers).text;
  }
  broadcast(room, now);
}

/** Entry point for socket messages (already parsed and shape-checked). */
export const handleMessage = async (user, msg, now = Date.now()) => {
  const action = actions[msg.type];
  if (!action) return error(user.userId, 'unknown-type');
  await action(user, msg, now);
};

/** Registers a socket; returns false when the user already has too many open. */
export const connect = (user, ws) => {
  if (!sockets.has(user.userId)) sockets.set(user.userId, new Set());
  if (sockets.get(user.userId).size >= RACE_MAX_SOCKETS_PER_USER) return false;
  sockets.get(user.userId).add(ws);
  // Reconnecting mid-race: put the player back in their room.
  const room = rooms.get(roomOf.get(user.userId));
  if (room) {
    const player = findPlayer(room, user.userId);
    if (player) player.connected = true;
    broadcast(room);
  }
  return true;
};

export const disconnect = (user, ws) => {
  const set = sockets.get(user.userId);
  set?.delete(ws);
  if (set && set.size === 0) {
    sockets.delete(user.userId);
    detach(user.userId, Date.now(), { reconnectable: true });
  }
};

// ---------------------------------------------------------- lifecycle

const startRace = async (room) => {
  const totalWords = room.text.split(' ').length;
  await Promise.all(
    room.players.map((p) =>
      startRaceSession(p.userId, {
        code: room.code,
        text: room.text,
        totalWords,
        wordCount: room.mode === 'time' ? totalWords : room.wordCount,
        timeMax: room.mode === 'time' ? room.timeLimit : undefined,
        punctuation: room.punctuation,
        numbers: room.numbers,
        startAt: room.startAt,
      })
        .catch((err) => console.error('[race] could not prepare session', p.userId, err?.message))
    )
  );
  broadcast(room);
};

const persistRace = async (room) => {
  try {
    await Race.create({
      code: room.code,
      name: room.name,
      hostId: room.hostId,
      isPrivate: room.isPrivate,
      mode: room.mode,
      wordCount: room.wordCount,
      timeLimit: room.timeLimit,
      text: room.text,
      startAt: new Date(room.startAt),
      finishedAt: new Date(room.finishedAt),
      winnerId: room.winnerId,
      players: room.players.map((p) => ({
        userId: p.userId,
        place: p.place,
        finishedAt: p.finishedAt ? new Date(p.finishedAt) : null,
        wpm: p.result?.wpm ?? null,
        accuracy: p.result?.accuracy ?? null,
        ranked: !!p.result?.ranked,
        resultId: p.result?.resultId ?? null,
      })),
    });
    // A win only counts against at least one other racer.
    if (room.winnerId && room.players.length >= RACE_MIN_PLAYERS) {
      await User.updateOne({ _id: room.winnerId }, { $inc: { 'stats.raceWins': 1 } });
      await syncAchievements(room.winnerId);
    }
  } catch (err) {
    console.error('[race] could not persist race', room.code, err?.message);
  }
};

// A finished run from POST /game/end (see game.service endGame).
gameEvents.on('run:finished', ({ userId, session, results, resultId, ranked }) => {
  const room = rooms.get(session.raceCode);
  if (!room) return;
  // A word race is finished by covering the whole text; a timed race by the
  // clock running out.
  const completed = room.mode === 'time' || results.completionPercentage >= 100;
  const outcome = recordFinish(room, String(userId), { wpm: results.wpm, accuracy: results.accuracy, ranked, resultId, completed }, Date.now());
  if (outcome === 'finished') void persistRace(room);
  if (outcome === null || outcome === 'finished') broadcast(room);
});

const loop = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const transition = tick(room, now);
    if (transition === 'started') void startRace(room);
    if (transition === 'finished') {
      void persistRace(room);
      broadcast(room, now);
    }
    const idle = now - room.updatedAt;
    if ((room.state === 'lobby' && idle > RACE_LOBBY_IDLE_MS) || (room.state === 'finished' && idle > RACE_FINISHED_TTL_MS)) {
      for (const p of room.players) if (roomOf.get(p.userId) === code) roomOf.delete(p.userId);
      rooms.delete(code);
    }
  }
}, RACE_TICK_MS);
loop.unref();

/** Test/admin helper. */
export const _rooms = rooms;
