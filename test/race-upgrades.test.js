import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formMatches } from '../src/services/race/matchmaking.js';
import { createRoom, finishRace, joinRoom, kickPlayer, normalizeSettings, ratingChanges, recordFinish, resetForRematch, setReady, tick, publicRoom } from '../src/services/race/race-machine.js';
import { cleanChat } from '../src/services/race/race-manager.js';
import { _validShape } from '../src/sockets/race.socket.js';
import { CHAT_MAX_LENGTH, QUICK_MATCH_MAX_PLAYERS, QUICK_MATCH_WAIT_MS, QUICK_MATCH_WIDEN_AFTER_MS, RACE_MAX_PLAYERS } from '../src/config/race.js';

const user = (id, rating = 1000) => ({ userId: id, username: id, displayName: id, rating });

describe('formMatches', () => {
  const T = 1_000_000;
  it('waits for a second player and the wait time', () => {
    assert.deepEqual(formMatches([{ userId: 'a', rating: 1000, at: T }], T + 60_000), []);
    const q = [{ userId: 'a', rating: 1000, at: T }, { userId: 'b', rating: 1050, at: T + 1000 }];
    assert.deepEqual(formMatches(q, T + 1000), []);
    assert.deepEqual(formMatches(q, T + QUICK_MATCH_WAIT_MS), [['a', 'b']]);
  });

  it('starts a full group at once', () => {
    const q = Array.from({ length: QUICK_MATCH_MAX_PLAYERS }, (_, i) => ({ userId: `p${i}`, rating: 1000 + i, at: T }));
    assert.equal(formMatches(q, T)[0].length, QUICK_MATCH_MAX_PLAYERS);
  });

  it('keeps distant ratings apart until someone has waited long', () => {
    const q = [{ userId: 'low', rating: 900, at: T }, { userId: 'high', rating: 1600, at: T }];
    assert.deepEqual(formMatches(q, T + QUICK_MATCH_WAIT_MS), []);
    assert.deepEqual(formMatches(q, T + QUICK_MATCH_WIDEN_AFTER_MS), [['low', 'high']]);
  });
});

describe('ratingChanges', () => {
  it('moves rating from losers to the winner, zero-sum', () => {
    const c = ratingChanges([
      { userId: 'a', rating: 1000, place: 1, verified: true },
      { userId: 'b', rating: 1000, place: 2, verified: true },
      { userId: 'c', rating: 1000, place: null, verified: false },
    ]);
    assert.ok(c.get('a') > 0 && c.get('c') < 0);
    assert.ok(Math.abs([...c.values()].reduce((x, y) => x + y, 0)) <= 1);
  });

  it('treats an unverified finish as not finishing', () => {
    const c = ratingChanges([
      { userId: 'cheat', rating: 1000, place: 1, verified: false },
      { userId: 'honest', rating: 1000, place: 2, verified: true },
    ]);
    assert.ok(c.get('honest') > 0);
  });

  it('gains less for beating a weaker player', () => {
    const vsWeak = ratingChanges([{ userId: 'a', rating: 1400, place: 1, verified: true }, { userId: 'b', rating: 1000, place: 2, verified: true }]);
    const vsEqual = ratingChanges([{ userId: 'a', rating: 1000, place: 1, verified: true }, { userId: 'b', rating: 1000, place: 2, verified: true }]);
    assert.ok(vsWeak.get('a') < vsEqual.get('a'));
  });
});

describe('rooms', () => {
  it('honours the host-set player cap, up to 8', () => {
    const room = createRoom({ code: 'TYPE-AAAA', host: user('h'), name: 'x', wordCount: 25, maxPlayers: 2, now: 0 });
    assert.equal(joinRoom(room, user('a'), 0), null);
    assert.equal(joinRoom(room, user('b'), 0), 'room-full');
    assert.equal(normalizeSettings({ maxPlayers: RACE_MAX_PLAYERS }).maxPlayers, RACE_MAX_PLAYERS);
    assert.equal(normalizeSettings({ maxPlayers: 99 }), null, 'the manager rejects a cap above the maximum');
  });

  it('rematches with the connected players and updated ratings', () => {
    const room = createRoom({ code: 'TYPE-AAAA', host: user('h', 1000), name: 'x', wordCount: 25, rated: true, now: 0 });
    joinRoom(room, user('a', 1100), 0);
    setReady(room, 'h', true, 0);
    setReady(room, 'a', true, 0);
    room.text = 'abc';
    tick(room, room.startAt);
    recordFinish(room, 'h', { wpm: 50, accuracy: 100, ranked: true, completed: true }, room.startAt + 1000);
    room.players[1].connected = false;
    finishRace(room, room.startAt + 2000);
    room.ratingChanges = { h: 20, a: -20 };
    assert.equal(resetForRematch(room, 'h', 5000), null);
    assert.equal(room.state, 'lobby');
    assert.deepEqual(room.players.map((p) => [p.userId, p.rating, p.ready]), [['h', 1020, false]]);
    assert.equal(publicRoom(room, 0).ratingChanges, null);
  });

  it('only rematches a finished race', () => {
    const room = createRoom({ code: 'X', host: user('h'), wordCount: 25, now: 0 });
    assert.equal(resetForRematch(room, 'h', 0), 'not-finished');
  });
});

describe('kicking', () => {
  const lobby = () => {
    const room = createRoom({ code: 'TYPE-KICK', host: user('h'), name: 'x', wordCount: 25, maxPlayers: 4, now: 0 });
    joinRoom(room, user('a'), 0);
    return room;
  };

  it('removes the player and bars them from rejoining', () => {
    const room = lobby();
    assert.equal(kickPlayer(room, 'h', 'a', 1), null);
    assert.equal(room.players.some((p) => p.userId === 'a'), false);
    assert.equal(joinRoom(room, user('a'), 2), 'banned');
  });

  it('keeps the ban across a rematch', () => {
    const room = lobby();
    kickPlayer(room, 'h', 'a', 1);
    room.state = 'finished';
    assert.equal(resetForRematch(room, 'h', 2), null);
    assert.equal(joinRoom(room, user('a'), 3), 'banned');
  });

  it('is host only and never on yourself', () => {
    const room = lobby();
    assert.equal(kickPlayer(room, 'a', 'h', 1), 'not-host');
    assert.equal(kickPlayer(room, 'h', 'h', 1), 'cannot-kick-self');
    assert.equal(kickPlayer(room, 'h', 'zz', 1), 'not-in-room');
  });

  it('is refused mid-race and in rated rooms', () => {
    const racing = lobby();
    racing.state = 'racing';
    assert.equal(kickPlayer(racing, 'h', 'a', 1), 'already-started');
    const rated = createRoom({ code: 'TYPE-RATE', host: user('h'), name: 'x', wordCount: 25, rated: true, now: 0 });
    joinRoom(rated, user('a'), 0);
    assert.equal(kickPlayer(rated, 'h', 'a', 1), 'rated-room');
  });

  it('stops a countdown that is no longer everyone ready', () => {
    const room = lobby();
    joinRoom(room, user('b'), 0);
    for (const id of ['h', 'a', 'b']) setReady(room, id, true, 1);
    assert.equal(room.state, 'countdown');
    kickPlayer(room, 'h', 'b', 2);
    // h and a are both still ready, so the race goes ahead without b.
    assert.equal(room.state, 'countdown');
    kickPlayer(room, 'h', 'a', 3);
    assert.equal(room.state, 'lobby');
  });

  it('is an allowed socket message, and public by default', () => {
    assert.equal(_validShape({ type: 'kick', userId: 'a' }), true);
    assert.equal(createRoom({ code: 'TYPE-PUBL', host: user('h'), name: 'x', wordCount: 25, now: 0 }).isPrivate, false);
  });
});

describe('chat', () => {
  it('strips control characters and caps the length', () => {
    assert.equal(cleanChat('  hi\u0000 there\n '), 'hi there');
    assert.equal(cleanChat('x'.repeat(500)).length, CHAT_MAX_LENGTH);
    assert.equal(cleanChat(42), '');
  });

  it('accepts the new socket messages', () => {
    for (const msg of [{ type: 'queue' }, { type: 'rematch' }, { type: 'spectate', code: 'TYPE-AAAA' }, { type: 'chat', text: 'gg' }, { type: 'emote', emote: 'gg' }, { type: 'create', wordCount: 25, maxPlayers: 6 }]) {
      assert.equal(_validShape(msg), true, msg.type);
    }
    assert.equal(_validShape({ type: 'chat', text: 1 }), false);
  });
});
