import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import User from '../models/user.model.js';
import { JWT_SECRET } from '../config/env.js';
import { JWT_VERIFY_OPTIONS } from '../services/auth.service.js';
import {
  RACE_AUTH_TIMEOUT_MS,
  RACE_MAX_MESSAGE_BYTES,
  RACE_MAX_MESSAGES_PER_SECOND,
  RACE_SOCKET_PATH,
} from '../config/race.js';
import { connect, disconnect, handleMessage } from '../services/race/race-manager.js';
import { publicHandle, publicName, staffRole } from '../utils/public-identity.js';

// Allowed fields per message type; anything else is rejected before it
// reaches the race manager.
const SHAPES = {
  create: {
    name: 'string?',
    isPrivate: 'boolean?',
    mode: 'string?',
    category: 'string?',
    wordCount: 'number?',
    timeLimit: 'number?',
    maxPlayers: 'number?',
    countdownSec: 'number?',
    punctuation: 'boolean?',
    numbers: 'boolean?',
  },
  settings: {
    mode: 'string?',
    category: 'string?',
    wordCount: 'number?',
    timeLimit: 'number?',
    maxPlayers: 'number?',
    countdownSec: 'number?',
    punctuation: 'boolean?',
    numbers: 'boolean?',
  },
  join: { code: 'string' },
  leave: {},
  ready: { ready: 'boolean' },
  cancel: {},
  startNow: {},
  invite: { userId: 'string' },
  kick: { userId: 'string' },
  list: {},
  queue: {},
  unqueue: {},
  rematch: {},
  spectate: { code: 'string' },
  chat: { text: 'string' },
  emote: { emote: 'string' },
};

const validShape = (msg) => {
  const shape = SHAPES[msg?.type];
  if (!shape) return false;
  return Object.entries(msg).every(([key, value]) => {
    if (key === 'type') return true;
    const rule = shape[key];
    if (!rule) return false;
    const optional = rule.endsWith('?');
    if (optional && value === undefined) return true;
    if (typeof value !== rule.replace('?', '')) return false;
    return typeof value !== 'string' || value.length <= 100;
  });
};

const authenticate = async (token) => {
  const { userId } = jwt.verify(token, JWT_SECRET, JWT_VERIFY_OPTIONS);
  const user = await User.findById(userId).select('username displayName avatar role status stats.raceRating').lean();
  if (!user || user.status !== 'active') throw new Error('inactive');
  return {
    userId: user._id.toString(),
    username: publicHandle(user),
    displayName: publicName(user),
    avatar: user.avatar || '',
    role: staffRole(user),
    rating: user.stats?.raceRating ?? 1000,
  };
};

/**
 * Live race WebSocket at RACE_SOCKET_PATH. Protocol:
 * 1. client sends { type: 'auth', token } within RACE_AUTH_TIMEOUT_MS
 *    (the token travels in a message, not the URL, so it never lands in
 *    proxy or access logs)
 * 2. then race messages (see SHAPES); the server pushes { type: 'room' },
 *    'invited', 'rooms', 'left' and 'error' messages.
 *
 * @param {import('http').Server} server
 * @param {(origin: string|undefined) => boolean} isAllowedOrigin  same policy as CORS
 */
export const attachRaceSocket = (server, isAllowedOrigin) => {
  const wss = new WebSocketServer({
    server,
    path: RACE_SOCKET_PATH,
    maxPayload: RACE_MAX_MESSAGE_BYTES,
    // Browsers always send Origin; refusing others blocks cross-site use.
    verifyClient: ({ origin }) => !!origin && isAllowedOrigin(origin),
  });

  wss.on('connection', (ws) => {
    let user = null;
    let windowStart = Date.now();
    let count = 0;

    const authTimer = setTimeout(() => ws.close(4001, 'auth timeout'), RACE_AUTH_TIMEOUT_MS);

    ws.on('message', async (data) => {
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > RACE_MAX_MESSAGES_PER_SECOND) return;

      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (!user) {
        if (msg?.type !== 'auth' || typeof msg.token !== 'string') return ws.close(4001, 'auth required');
        try {
          user = await authenticate(msg.token);
        } catch {
          return ws.close(4003, 'auth failed');
        }
        clearTimeout(authTimer);
        if (!connect(user, ws)) {
          user = null;
          return ws.close(4008, 'too many connections');
        }
        ws.send(JSON.stringify({ type: 'ready', userId: user.userId, serverNow: Date.now() }));
        return;
      }

      if (!validShape(msg)) {
        ws.send(JSON.stringify({ type: 'error', code: 'bad-message' }));
        return;
      }
      try {
        await handleMessage(user, msg);
      } catch (err) {
        console.error('[race] message failed', msg.type, err?.message);
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (user) disconnect(user, ws);
    });
  });

  return wss;
};

export const _validShape = validShape;
