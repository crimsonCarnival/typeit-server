import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import gameController from '../src/controllers/game.controller.js';
import { clearGuestRuns, getGuestRun } from '../src/services/run-store.service.js';

const fakeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};
const call = async (handler, body) => {
  const res = fakeRes();
  await gameController[handler]({ body, user: null }, res);
  return res;
};
const keysFor = (chars, gap = 150) => [...chars].map((c, i) => [i === 0 ? 0 : gap, c]);

describe('guest run flow (server-scored)', () => {
  afterEach(() => clearGuestRuns());

  const newRun = async (rules) => {
    const res = await call('resetGame', { gameMode: 'words', wordCount: 5, timeMax: 30, ...(rules && { rules }) });
    assert.equal(res.statusCode, 200);
    return res.body.data;
  };

  it('streams keys, answers live stats and scores the end from the log', async () => {
    const state = await newRun();
    assert.ok(state.sessionId);
    assert.equal(state.rules.difficulty, 'normal');
    const text = state.text;

    const first = await call('progress', { sessionId: state.sessionId, from: 0, keys: keysFor(text.slice(0, 5)), elapsedMs: 800 });
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.data.keyCount, 5);
    assert.equal(first.body.data.live.position, 5);
    assert.equal(first.body.data.live.timeLeft, 30);

    const end = await call('endGame', {
      sessionId: state.sessionId,
      from: 5,
      keys: keysFor(text.slice(5)).map(([, c]) => [150, c]),
      typedText: text,
      elapsedMs: text.length * 150,
    });
    assert.equal(end.statusCode, 200);
    assert.equal(end.body.data.successes, text.length);
    assert.equal(end.body.data.accuracy, 100);
    assert.ok(end.body.data.wpm > 0);
    assert.ok(Array.isArray(end.body.data.performance));
    assert.ok(getGuestRun(state.sessionId).finished);
  });

  it('ignores any numbers the client sends', async () => {
    const state = await newRun();
    const end = await call('endGame', {
      sessionId: state.sessionId, from: 0, keys: keysFor('zz'), typedText: 'zz', elapsedMs: 5000,
      wpm: 999, accuracy: 100, performance: [{ timestamp: 1, wpm: 999 }], penalty: -50,
    });
    assert.equal(end.body.data.successes, 0);
    assert.equal(end.body.data.accuracy, 0);
  });

  it('answers 409 with the expected offset when keys go missing', async () => {
    const state = await newRun();
    await call('progress', { sessionId: state.sessionId, from: 0, keys: keysFor('ab'), elapsedMs: 300 });
    const res = await call('progress', { sessionId: state.sessionId, from: 5, keys: keysFor('c'), elapsedMs: 500 });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.data.keyCount, 2);
  });

  it('applies the run rules (hardcore time penalty shortens the clock)', async () => {
    const state = await newRun({ difficulty: 'hardcore' });
    const keys = [[0, state.text[0]], [100, '\b'], [100, state.text[0]], [100, '\b'], [100, state.text[0]], [100, '\b']];
    const res = await call('progress', { sessionId: state.sessionId, from: 0, keys, elapsedMs: 1000 });
    assert.equal(res.body.data.live.penalty.seconds, 1);
    assert.equal(res.body.data.live.deadlineMs, 29_000);
  });

  it('rejects unknown runs and bad key batches', async () => {
    assert.equal((await call('progress', { sessionId: 'nope', from: 0, keys: [] })).statusCode, 404);
    const state = await newRun();
    assert.equal((await call('progress', { sessionId: state.sessionId, from: 0, keys: [[0, 'ab']] })).statusCode, 400);
  });
});
