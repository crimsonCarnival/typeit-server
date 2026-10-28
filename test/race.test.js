import { after, afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import WebSocket from 'ws';
import User from '../src/models/user.model.js';
import { JWT_SECRET } from '../src/config/env.js';
import {
  cancelCountdown,
  createRoom,
  joinRoom,
  leaveRoom,
  publicRoom,
  recordFinish,
  setReady,
  startNow,
  tick,
  updateProgress,
} from '../src/services/race/race-machine.js';
import { attachRaceSocket, _validShape } from '../src/sockets/race.socket.js';
import {
  RACE_COUNTDOWN_MS,
  RACE_MAX_PLAYERS,
  RACE_SOCKET_PATH,
  RACE_START_NOW_DELAY_MS,
  RACE_TIMEOUT_MS,
} from '../src/config/race.js';

const player = (n) => ({ userId: `u${n}`, username: `p${n}`, displayName: `P${n}` });
const T0 = 1_000_000;

const lobby = (players = 2) => {
  const room = createRoom({ code: 'TYPE-AAAA', host: player(1), name: 'Friday sprint', wordCount: 25, isPrivate: true, now: T0 });
  for (let i = 2; i <= players; i++) joinRoom(room, player(i), T0);
  return room;
};

const racing = (players = 2) => {
  const room = lobby(players);
  for (let i = 1; i <= players; i++) setReady(room, `u${i}`, true, T0);
  room.text = 'the quick brown fox';
  tick(room, room.startAt);
  return room;
};

describe('race state machine', () => {
  it('goes lobby -> countdown -> racing -> finished', () => {
    const room = lobby();
    assert.equal(room.state, 'lobby');

    setReady(room, 'u1', true, T0);
    assert.equal(room.state, 'lobby', 'one ready player is not enough');
    setReady(room, 'u2', true, T0 + 100);
    assert.equal(room.state, 'countdown');
    assert.equal(room.startAt, T0 + 100 + RACE_COUNTDOWN_MS, 'server fixes the start time');

    room.text = 'go go go';
    assert.equal(tick(room, room.startAt - 1), null);
    assert.equal(tick(room, room.startAt), 'started');
    assert.equal(room.state, 'racing');

    assert.equal(recordFinish(room, 'u2', { wpm: 80, accuracy: 98, ranked: true }, room.startAt + 9000), null);
    assert.equal(recordFinish(room, 'u1', { wpm: 70, accuracy: 99, ranked: true }, room.startAt + 11000), 'finished');
    assert.equal(room.state, 'finished');
    assert.equal(room.winnerId, 'u2');
    assert.deepEqual(room.players.map((p) => [p.userId, p.place]), [['u1', 2], ['u2', 1]]);
  });

  it('needs at least two players to count down', () => {
    const room = lobby(1);
    setReady(room, 'u1', true, T0);
    assert.equal(room.state, 'lobby');
  });

  it('caps the room size', () => {
    const room = lobby(RACE_MAX_PLAYERS);
    assert.equal(joinRoom(room, player(9), T0), 'room-full');
  });

  it('stops the countdown when someone unreadies, cancels, joins or leaves', () => {
    const counting = () => {
      const r = lobby(3);
      ['u1', 'u2', 'u3'].forEach((u) => setReady(r, u, true, T0));
      return r;
    };
    let r = counting();
    setReady(r, 'u2', false, T0);
    assert.equal(r.state, 'lobby');

    r = counting();
    assert.equal(cancelCountdown(r, 'u3', T0), null);
    assert.equal(r.state, 'lobby');
    assert.equal(r.players.find((p) => p.userId === 'u3').ready, false);

    r = counting();
    joinRoom(r, player(4), T0);
    assert.equal(r.state, 'lobby');

    r = counting();
    leaveRoom(r, 'u3', T0);
    assert.equal(r.state, 'countdown', 'two ready players remain');
    leaveRoom(r, 'u2', T0);
    assert.equal(r.state, 'lobby');
  });

  it('lets only the host start early, and never before the minimum delay', () => {
    const r = lobby();
    setReady(r, 'u1', true, T0);
    setReady(r, 'u2', true, T0);
    assert.equal(startNow(r, 'u2', T0), 'not-host');
    assert.equal(startNow(r, 'u1', T0 + 1000), null);
    assert.equal(r.startAt, T0 + 1000 + RACE_START_NOW_DELAY_MS);
  });

  it('passes host to the next player when the host leaves the lobby', () => {
    const r = lobby(3);
    leaveRoom(r, 'u1', T0);
    assert.equal(r.hostId, 'u2');
  });

  it('refuses joins once the race has started', () => {
    assert.equal(joinRoom(racing(), player(3), T0), 'already-started');
  });

  it('computes live WPM from the server clock and clamps progress', () => {
    const r = racing();
    updateProgress(r, 'u1', { index: 10, accuracy: 150 }, r.startAt + 12000); // 10 chars in 12s = 10 WPM
    const p = r.players[0];
    assert.equal(p.wpm, 10);
    assert.equal(p.accuracy, 100);
    updateProgress(r, 'u1', { index: 999 }, r.startAt + 13000);
    assert.equal(p.index, r.text.length);
    assert.equal(updateProgress(r, 'u1', { index: -1 }, r.startAt), 'bad-progress');
  });

  it('never awards the win to an unverified run', () => {
    const r = racing();
    recordFinish(r, 'u1', { wpm: 300, accuracy: 100, ranked: false }, r.startAt + 1000);
    recordFinish(r, 'u2', { wpm: 60, accuracy: 95, ranked: true }, r.startAt + 20000);
    assert.equal(r.players.find((p) => p.userId === 'u1').place, 1);
    assert.equal(r.winnerId, 'u2');
  });

  it('has no winner when nobody verified', () => {
    const r = racing();
    recordFinish(r, 'u1', { wpm: 50, accuracy: 90, ranked: false }, r.startAt + 1000);
    recordFinish(r, 'u2', { wpm: 50, accuracy: 90, ranked: false }, r.startAt + 2000);
    assert.equal(r.winnerId, null);
  });

  it('ends when the last racer still typing disconnects', () => {
    const r = racing(3);
    recordFinish(r, 'u1', { wpm: 70, accuracy: 97, ranked: true }, r.startAt + 9000);
    assert.equal(leaveRoom(r, 'u2', r.startAt + 9500).finished, false);
    assert.equal(leaveRoom(r, 'u3', r.startAt + 9600).finished, true);
    assert.equal(r.state, 'finished');
    assert.equal(r.players.find((p) => p.userId === 'u2').place, null, 'did not finish');
  });

  it('times out unfinished racers', () => {
    const r = racing();
    recordFinish(r, 'u1', { wpm: 70, accuracy: 97, ranked: true }, r.startAt + 9000);
    assert.equal(tick(r, r.startAt + RACE_TIMEOUT_MS - 1), null);
    assert.equal(tick(r, r.startAt + RACE_TIMEOUT_MS), 'finished');
    assert.equal(r.winnerId, 'u1');
  });

  it('ignores a second finish from the same player', () => {
    const r = racing(3);
    recordFinish(r, 'u1', { wpm: 70, accuracy: 97, ranked: true }, r.startAt + 9000);
    assert.equal(recordFinish(r, 'u1', { wpm: 99, accuracy: 99, ranked: true }, r.startAt + 9500), 'already-finished');
  });

  it('withholds the text until the race starts', () => {
    const r = lobby();
    setReady(r, 'u1', true, T0);
    setReady(r, 'u2', true, T0);
    r.text = 'secret words';
    assert.equal(publicRoom(r, T0).text, null);
    tick(r, r.startAt);
    assert.equal(publicRoom(r, r.startAt).text, 'secret words');
    assert.equal('result' in publicRoom(r, T0).players[0], false);
  });
});

describe('race socket message validation', () => {
  it('accepts known shapes and rejects anything else', () => {
    assert.equal(_validShape({ type: 'create', wordCount: 25, name: 'x', isPrivate: true }), true);
    assert.equal(_validShape({ type: 'create', wordCount: '25' }), false);
    assert.equal(_validShape({ type: 'progress', index: 3, extra: 1 }), false);
    assert.equal(_validShape({ type: 'join', code: 'x'.repeat(101) }), false);
    assert.equal(_validShape({ type: 'nope' }), false);
    assert.equal(_validShape(null), false);
  });
});

describe('race socket', () => {
  let server;
  let url;
  const ORIGIN = 'http://localhost:4200';
  const ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];

  before(async () => {
    mock.method(User, 'findById', (id) => ({
      select: () => ({
        lean: async () => ({ _id: id, username: `user${String(id).slice(-3)}`, displayName: '', avatar: '', status: 'active' }),
      }),
    }));
    server = http.createServer();
    attachRaceSocket(server, (origin) => origin === ORIGIN);
    await new Promise((resolve) => server.listen(0, resolve));
    url = `ws://localhost:${server.address().port}${RACE_SOCKET_PATH}`;
  });

  after(() => {
    mock.restoreAll();
    server.close();
  });

  const open = (origin = ORIGIN) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { origin });
      const inbox = [];
      ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
      ws.on('open', () => resolve({ ws, inbox }));
      ws.on('error', reject);
    });

  const waitFor = async (inbox, pred, ms = 2000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const hit = inbox.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out waiting for message');
  };

  it('rejects connections from other origins', async () => {
    await assert.rejects(open('https://evil.example'), /Unexpected server response: 401/);
  });

  it('closes sockets that send a bad token', async () => {
    const { ws } = await open();
    const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
    ws.send(JSON.stringify({ type: 'auth', token: 'garbage' }));
    assert.equal(await closed, 4003);
  });

  it('runs a two-player lobby up to the countdown', async () => {
    const a = await open();
    const b = await open();
    a.ws.send(JSON.stringify({ type: 'auth', token: jwt.sign({ userId: String(ids[0]) }, JWT_SECRET) }));
    b.ws.send(JSON.stringify({ type: 'auth', token: jwt.sign({ userId: String(ids[1]) }, JWT_SECRET) }));
    await waitFor(a.inbox, (m) => m.type === 'ready');
    await waitFor(b.inbox, (m) => m.type === 'ready');

    a.ws.send(JSON.stringify({ type: 'progress', index: 1, bogus: true }));
    await waitFor(a.inbox, (m) => m.type === 'error' && m.code === 'bad-message');

    a.ws.send(JSON.stringify({ type: 'create', name: 'Test', wordCount: 25, isPrivate: true }));
    const created = await waitFor(a.inbox, (m) => m.type === 'room');
    assert.match(created.room.code, /^TYPE-[2-9A-HJKMNP-Z]{4}$/);

    b.ws.send(JSON.stringify({ type: 'join', code: created.room.code.toLowerCase() }));
    await waitFor(a.inbox, (m) => m.type === 'room' && m.room.players.length === 2);

    a.ws.send(JSON.stringify({ type: 'ready', ready: true }));
    b.ws.send(JSON.stringify({ type: 'ready', ready: true }));
    const counting = await waitFor(b.inbox, (m) => m.type === 'room' && m.room.state === 'countdown');
    assert.ok(counting.room.startAt > counting.room.serverNow);
    assert.equal(counting.room.text, null, 'text stays hidden during the countdown');

    a.ws.close();
    b.ws.close();
  });
});
