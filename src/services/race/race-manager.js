import crypto from 'crypto';
import mongoose from 'mongoose';
import Race from '../../models/race.model.js';
import User from '../../models/user.model.js';
import { gameEvents } from '../../events/game-events.js';
import { generateText, startRaceSession } from '../game.service.js';
import { syncAchievements } from '../achievement.service.js';
import { areMutual } from '../follow.service.js';
import { formMatches } from './matchmaking.js';
import {
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY_LIMIT,
  CHAT_MAX_LENGTH,
  QUICK_MATCH_MAX_PLAYERS,
  QUICK_MATCH_WORD_COUNT,
  RACE_EMOTES,
  RACE_MAX_SPECTATORS,
  RATING_START,
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
  RACE_TIMED_FINISH_TOLERANCE_S as TIMED_FINISH_TOLERANCE_S,
  RACE_TIMED_WORDS_PER_SECOND,
} from '../../config/race.js';
import {
  cancelCountdown,
  createRoom,
  findPlayer,
  isBanned,
  joinRoom,
  kickPlayer,
  leaveRoom,
  normalizeSettings,
  publicRoom,
  ratingChanges,
  recordFinish,
  resetForRematch,
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
const watching = new Map(); // userId -> code of the room they spectate
const queue = new Map(); // userId -> { user, rating, at } waiting for a quick match
const lastChat = new Map(); // userId -> ms

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
  for (const id of room.spectators ?? []) sendTo(id, { type: 'room', room: view, spectating: true });
};

/** Players and spectators of a room. */
const everyoneIn = (room) => [...room.players.map((p) => p.userId), ...(room.spectators ?? [])];

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
  queue.delete(userId);
  stopWatching(userId, now);
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

/** Stops spectating, if the user was. */
const stopWatching = (userId, now) => {
  const code = watching.get(userId);
  if (!code) return;
  watching.delete(userId);
  const room = rooms.get(code);
  if (!room) return;
  room.spectators = room.spectators.filter((id) => id !== userId);
  broadcast(room, now);
};

/** Looks up the ratings of users who are about to race (quick match). */
const ratingOf = async (userId) => {
  const u = await User.findById(userId).select('stats.raceRating').lean();
  return u?.stats?.raceRating ?? RATING_START;
};

/** Removes control characters and squeezes whitespace in a chat message. */
export const cleanChat = (text) =>
  typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH) : '';

/** Mutual follows count as friends (who can invite each other). */
const areFriends = (a, b) => areMutual(a, b);

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
    sendChatHistory(user.userId, room);
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

  /** Host only: removes a player and bars them from coming back. */
  kick(user, { userId: target }, now) {
    if (typeof target !== 'string') return error(user.userId, 'bad-kick');
    const room = rooms.get(roomOf.get(user.userId));
    if (!room) return error(user.userId, 'not-in-room');
    const err = kickPlayer(room, user.userId, target, now);
    if (err) return error(user.userId, err);
    roomOf.delete(target);
    sendTo(target, { type: 'kicked', code: room.code, name: room.name });
    broadcast(room, now);
  },

  cancel(user, _msg, now) {
    withRoom(user, (room) => cancelCountdown(room, user.userId, now), now);
  },

  startNow(user, _msg, now) {
    withRoom(user, (room) => startNow(room, user.userId, now), now);
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
    // Public lobbies to join, and public races under way to watch.
    const open = [...rooms.values()]
      .filter((r) => !r.isPrivate && r.state !== 'finished')
      .map((r) => ({
        code: r.code,
        name: r.name,
        mode: r.mode,
        category: r.category,
        wordCount: r.wordCount,
        timeLimit: r.timeLimit,
        players: r.players.length,
        maxPlayers: r.maxPlayers,
        state: r.state,
        rated: !!r.rated,
      }));
    sendTo(user.userId, { type: 'rooms', rooms: open });
  },

  /** Joins the quick-match queue (rated public races, matched by rating). */
  async queue(user, _msg, now) {
    detach(user.userId, now);
    const rating = await ratingOf(user.userId);
    queue.set(user.userId, { user: { ...user, rating }, userId: user.userId, rating, at: now });
    sendTo(user.userId, { type: 'queue', queued: true, size: queue.size, rating });
  },

  unqueue(user) {
    queue.delete(user.userId);
    sendTo(user.userId, { type: 'queue', queued: false, size: queue.size });
  },

  /** Back to the lobby with the same players and settings once a race is over. */
  rematch(user, _msg, now) {
    withRoom(user, (room) => resetForRematch(room, user.userId, now), now);
  },

  /** Watches a room: public rooms by code from the list, private ones only with their code. */
  spectate(user, { code }, now) {
    if (tooManyFailedJoins(user.userId, now)) return error(user.userId, 'too-many-attempts');
    const room = typeof code === 'string' && rooms.get(code.trim().toUpperCase());
    if (!room) {
      failedJoins.get(user.userId).push(now);
      return error(user.userId, 'room-not-found');
    }
    if (isBanned(room, user.userId)) return error(user.userId, 'banned');
    if (findPlayer(room, user.userId)) return error(user.userId, 'already-racing');
    if (room.spectators.length >= RACE_MAX_SPECTATORS) return error(user.userId, 'too-many-spectators');
    detach(user.userId, now);
    room.spectators.push(user.userId);
    watching.set(user.userId, room.code);
    broadcast(room, now);
    sendChatHistory(user.userId, room);
  },

  chat(user, { text }, now) {
    const message = cleanChat(text);
    if (!message) return error(user.userId, 'empty-message');
    say(user, { text: message }, now);
  },

  emote(user, { emote }, now) {
    if (!RACE_EMOTES.includes(emote)) return error(user.userId, 'bad-emote');
    say(user, { emote }, now);
  },
};

// Timed races get more text than anyone can finish before the clock runs out.
const textWords = (room) => (room.mode === 'time' ? room.timeLimit * RACE_TIMED_WORDS_PER_SECOND : room.wordCount);
/** Sends a chat line or emote to everyone in the sender's room. */
function say(user, content, now) {
  const code = roomOf.get(user.userId) ?? watching.get(user.userId);
  const room = code && rooms.get(code);
  if (!room) return error(user.userId, 'not-in-room');
  if (now - (lastChat.get(user.userId) ?? 0) < CHAT_COOLDOWN_MS) return error(user.userId, 'chat-cooldown');
  lastChat.set(user.userId, now);
  const msg = { type: 'chat', from: { userId: user.userId, displayName: user.displayName }, ...content, at: now };
  const { type: _type, ...line } = msg;
  room.chat = [...(room.chat ?? []), line].slice(-CHAT_HISTORY_LIMIT);
  for (const id of everyoneIn(room)) sendTo(id, msg);
}

/** Lets someone who just joined, watched or reconnected catch up on the chat. */
const sendChatHistory = (userId, room) => {
  if (room.chat?.length) sendTo(userId, { type: 'chat-history', lines: room.chat });
};

/** Puts a matched group in a new rated room and starts its countdown. */
async function startQuickMatch(userIds, now) {
  const entries = userIds.map((id) => queue.get(id)).filter(Boolean);
  for (const e of entries) queue.delete(e.userId);
  if (entries.length < RACE_MIN_PLAYERS) return;
  const [host, ...rest] = entries.map((e) => e.user);
  const room = createRoom({
    code: newCode(),
    host,
    name: 'Quick match',
    wordCount: QUICK_MATCH_WORD_COUNT,
    isPrivate: false,
    maxPlayers: QUICK_MATCH_MAX_PLAYERS,
    rated: true,
    now,
  });
  for (const u of rest) joinRoom(room, u, now);
  rooms.set(room.code, room);
  for (const p of room.players) {
    roomOf.set(p.userId, room.code);
    setReady(room, p.userId, true, now);
  }
  room.text = generateText('words', room.wordCount, false, false).text;
  for (const p of room.players) sendTo(p.userId, { type: 'queue', queued: false, matched: room.code });
  broadcast(room, now);
}

function withRoom(user, fn, now) {
  const room = rooms.get(roomOf.get(user.userId));
  if (!room) return error(user.userId, 'not-in-room');
  const err = fn(room);
  if (err) return error(user.userId, err);
  if (room.state === 'countdown' && !room.text) {
    // Pick the text as the countdown starts; it is only revealed at startAt.
    const generated = room.mode === 'phrases'
      ? generateText('phrases', 0, false, false, { textCategory: room.category })
      : generateText('words', textWords(room), room.punctuation, room.numbers);
    room.text = generated.text;
    room.passage = generated.passage;
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
    sendChatHistory(user.userId, room);
  }
  return true;
};

export const disconnect = (user, ws) => {
  const set = sockets.get(user.userId);
  set?.delete(ws);
  if (set && set.size === 0) {
    sockets.delete(user.userId);
    queue.delete(user.userId);
    stopWatching(user.userId, Date.now());
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
        wordCount: room.mode === 'words' ? room.wordCount : totalWords,
        phrases: room.mode === 'phrases',
        passage: room.passage ?? null,
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
    const changes = room.rated
      ? ratingChanges(room.players.map((p) => ({
          userId: p.userId,
          rating: p.rating ?? RATING_START,
          place: p.place,
          verified: !!p.result?.ranked,
        })))
      : null;
    await Race.create({
      code: room.code,
      name: room.name,
      hostId: room.hostId,
      isPrivate: room.isPrivate,
      mode: room.mode,
      category: room.mode === 'phrases' ? room.category : null,
      rated: !!room.rated,
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
        ratingChange: changes ? changes.get(p.userId) : null,
      })),
    });
    if (changes) {
      await User.bulkWrite(
        [...changes].map(([userId, delta]) => ({
          updateOne: { filter: { _id: userId }, update: { $inc: { 'stats.raceRating': delta, 'stats.racesRated': 1 } } },
        }))
      );
      room.ratingChanges = Object.fromEntries(changes);
      broadcast(room);
    }
    // A win only counts against at least one other racer, and only a verified run earns it.
    const winner = room.players.find((p) => p.userId === room.winnerId);
    if (winner?.result?.ranked && room.players.length >= RACE_MIN_PLAYERS) {
      await User.updateOne({ _id: room.winnerId }, { $inc: { 'stats.raceWins': 1 } });
      await syncAchievements(room.winnerId);
    }
  } catch (err) {
    console.error('[race] could not persist race', room.code, err?.message);
  }
};

// Live progress from POST /game/progress: the server's replay of the racer's
// keys, never a position the client claims.
gameEvents.on('run:progress', ({ userId, code, index, accuracy }) => {
  const room = rooms.get(code);
  if (!room || roomOf.get(userId) !== code) return;
  const now = Date.now();
  // Progress is frequent; failures are silently dropped.
  if (!updateProgress(room, userId, { index, accuracy }, now)) broadcast(room, now);
});

// A finished run from POST /game/end (see game.service endGame).
gameEvents.on('run:finished', ({ userId, session, results, resultId, ranked }) => {
  const room = rooms.get(session.raceCode);
  if (!room) return;
  // A word race is finished by covering the whole text; a timed race by
  // lasting the whole clock, so quitting early can't post a short, fast run.
  const completed = room.mode === 'time'
    ? results.elapsedTime >= room.timeLimit - TIMED_FINISH_TOLERANCE_S
    : results.completionPercentage >= 100;
  const outcome = recordFinish(room, String(userId), { wpm: results.wpm, accuracy: results.accuracy, ranked, resultId, completed }, Date.now());
  if (outcome === 'finished') void persistRace(room);
  if (outcome === null || outcome === 'finished') broadcast(room);
});

const loop = setInterval(() => {
  const now = Date.now();
  if (queue.size >= RACE_MIN_PLAYERS) {
    for (const group of formMatches([...queue.values()], now)) void startQuickMatch(group, now);
  }
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
      for (const id of room.spectators ?? []) if (watching.get(id) === code) watching.delete(id);
      rooms.delete(code);
    }
  }
}, RACE_TICK_MS);
loop.unref();

/** Test/admin helpers. */
export const _rooms = rooms;
export const _queue = queue;
