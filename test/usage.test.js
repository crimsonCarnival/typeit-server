import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import UsageDay from '../src/models/usage-day.model.js';
import { USAGE_EVENTS_PER_REQUEST, USAGE_NEW_IDS_PER_IP } from '../src/config/usage.js';
import { PERMISSION_IDS } from '../src/config/permissions.js';
import { _resetCap, admitVisitor, hashVisitor, record, recordClientEvents, runUsage, usageKeys } from '../src/services/usage.service.js';

const uuid = (n) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const DAY = Date.UTC(2026, 9, 30, 12);

describe('visitor ids', () => {
  it('hashVisitor rejects anything but a UUID v4 and is stable', () => {
    assert.equal(hashVisitor('not-an-id'), null);
    assert.equal(hashVisitor(''), null);
    assert.equal(hashVisitor(42), null);
    const h = hashVisitor(uuid(1));
    assert.match(h, /^[0-9a-f]{32}$/);
    assert.equal(hashVisitor(uuid(1)), h);
    assert.notEqual(hashVisitor(uuid(2)), h);
    assert.ok(!h.includes('1111'), 'the raw id must not show through');
  });

  describe('new-id cap', () => {
    beforeEach(() => _resetCap());

    it(`admits ${USAGE_NEW_IDS_PER_IP} new ids per IP per day, then only known ones`, () => {
      for (let i = 0; i < USAGE_NEW_IDS_PER_IP; i++) assert.equal(admitVisitor('1.2.3.4', `h${i}`, DAY), true);
      assert.equal(admitVisitor('1.2.3.4', 'h-new', DAY), false);
      assert.equal(admitVisitor('1.2.3.4', 'h3', DAY), true, 'a known id keeps counting');
      assert.equal(admitVisitor('5.6.7.8', 'h-new', DAY), true, 'other IPs have their own budget');
    });

    it('starts over the next UTC day', () => {
      for (let i = 0; i < USAGE_NEW_IDS_PER_IP; i++) admitVisitor('1.2.3.4', `h${i}`, DAY);
      assert.equal(admitVisitor('1.2.3.4', 'h-new', DAY + 24 * 3600 * 1000), true);
    });
  });
});

describe('record', () => {
  let writes;
  beforeEach(() => {
    _resetCap();
    writes = mock.method(UsageDay, 'bulkWrite', async () => ({}));
  });
  afterEach(() => mock.restoreAll());

  const ops = () => writes.mock.calls[0].arguments[0].map((op) => op.updateOne);

  it('writes the feature and each detail, counting the visitor by hash', async () => {
    await record({ visitorId: uuid(1), ip: '1.1.1.1', user: null, key: 'test.words', dims: { time: 30, language: 'english' }, now: DAY });
    const all = ops();
    assert.deepEqual(all.map((o) => o.filter.key), ['test.words', 'test.words.time=30', 'test.words.language=english']);
    for (const o of all) {
      assert.equal(o.filter.day, '2026-10-30');
      assert.deepEqual(o.update.$inc, { 'times.guest': 1 });
      assert.deepEqual(o.update.$addToSet, { 'visitors.guest': hashVisitor(uuid(1)) });
      assert.equal(o.upsert, true);
    }
  });

  it('tags signed-in players as user and counts a finish without re-adding the visitor', async () => {
    await record({ visitorId: uuid(1), ip: '1.1.1.1', user: { _id: 'u1' }, key: 'test.code', finished: true, now: DAY });
    const [o] = ops();
    assert.deepEqual(o.update.$inc, { 'finished.user': 1 });
    assert.equal(o.update.$addToSet, undefined);
  });

  it('maps a detail value outside its list to other', async () => {
    await record({ visitorId: uuid(1), ip: '1.1.1.1', user: null, key: 'test.words', dims: { time: 45 }, now: DAY });
    assert.equal(ops()[1].filter.key, 'test.words.time=other');
  });

  it('ignores opted-out accounts, unknown keys, bad ids and ids over the cap', async () => {
    await record({ visitorId: uuid(1), ip: '1.1.1.1', user: { _id: 'u1', usageOptOut: true }, key: 'test.words', now: DAY });
    await record({ visitorId: uuid(1), ip: '1.1.1.1', user: null, key: 'made.up', now: DAY });
    await record({ visitorId: 'nope', ip: '1.1.1.1', user: null, key: 'test.words', now: DAY });
    for (let i = 0; i < USAGE_NEW_IDS_PER_IP; i++) admitVisitor('9.9.9.9', hashVisitor(uuid(100 + i)), DAY);
    await record({ visitorId: uuid(1), ip: '9.9.9.9', user: null, key: 'test.words', now: DAY });
    assert.equal(writes.mock.callCount(), 0);
  });

  it('never throws, even when the database does', async () => {
    writes.mock.mockImplementation(async () => { throw new Error('db down'); });
    await assert.doesNotReject(record({ visitorId: uuid(1), ip: '1.1.1.1', user: null, key: 'page.rankings', now: DAY }));
  });
});

describe('runUsage', () => {
  const base = { gameMode: 'words', wordCount: 25, timeMax: 30, language: 'english', punctuationEnabled: true, numbersEnabled: false };

  it('free-play runs count as their test mode with details', () => {
    assert.deepEqual(runUsage(base), { key: 'test.words', dims: { words: 25, time: 30, language: 'english', modifiers: 'punctuation' } });
    assert.deepEqual(runUsage({ gameMode: 'phrases', textCategory: 'quotes' }), { key: 'test.phrases', dims: { category: 'quotes' } });
    assert.deepEqual(runUsage({ gameMode: 'code', codeLanguage: 'go', timeMax: 60 }), { key: 'test.code', dims: { language: 'go', time: 60 } });
  });

  it('daily, ghost, lessons, practice and races get their own rows, not a test row', () => {
    assert.deepEqual(runUsage({ ...base, dailyDate: '2026-10-30' }), { key: 'daily', dims: { action: 'attempt' } });
    assert.deepEqual(runUsage({ ...base, practice: { kind: 'ghost' } }), { key: 'daily', dims: { action: 'ghost' } });
    assert.deepEqual(runUsage({ ...base, practice: { kind: 'lesson', id: 'home-right' } }), { key: 'lessons', dims: { lesson: 'home-right' } });
    assert.deepEqual(runUsage({ ...base, practice: { kind: 'weak-keys' } }), { key: 'practice', dims: { kind: 'drills' } });
    assert.deepEqual(runUsage({ ...base, practice: { kind: 'list' } }), { key: 'practice', dims: { kind: 'word-lists' } });
    assert.deepEqual(runUsage({ ...base, raceCode: 'ABCD' }, { roomSize: 3 }), { key: 'race.live', dims: { action: 'started', size: '3-4' } });
    assert.deepEqual(runUsage({ ...base, raceCode: 'ABCD' }, { roomSize: 6, phase: 'finish' }), { key: 'race.live', dims: { action: 'finished', size: '5+' } });
  });

  it('a valid bot speed makes it a bot race; anything else is ignored', () => {
    assert.deepEqual(runUsage(base, { botWpm: 60 }), { key: 'race.bot', dims: { speed: 60 } });
    assert.equal(runUsage(base, { botWpm: 61 }).key, 'test.words');
  });
});

describe('usageKeys', () => {
  it('lists the feature then each detail, keeping only catalogued details', () => {
    assert.deepEqual(usageKeys('race.live', { action: 'joined', size: 7, bogus: 'x' }), ['race.live', 'race.live.action=joined', 'race.live.size=other']);
    assert.deepEqual(usageKeys('nope'), []);
  });
});

describe('browser events', () => {
  let writes;
  beforeEach(() => {
    _resetCap();
    writes = mock.method(UsageDay, 'bulkWrite', async () => ({}));
  });
  afterEach(() => mock.restoreAll());

  it('keeps only listed keys, once each, and at most a batch', async () => {
    const events = [{ key: 'page.rankings' }, { key: 'page.rankings' }, { key: 'test.words' }, { key: 'evil' }, 'junk', { key: 'daily:past-day' }];
    recordClientEvents({ visitorId: uuid(1), events, ip: '1.1.1.1', user: null, now: DAY });
    recordClientEvents({ visitorId: uuid(1), events: 'nope', ip: '1.1.1.1', user: null, now: DAY });
    recordClientEvents({ visitorId: uuid(1), events: [...Array(USAGE_EVENTS_PER_REQUEST).fill({ key: 'evil' }), { key: 'page.stats' }], ip: '1.1.1.1', user: null, now: DAY });
    await new Promise((r) => setImmediate(r));
    const keys = writes.mock.calls.map((c) => c.arguments[0].map((op) => op.updateOne.filter.key));
    assert.deepEqual(keys, [['page.rankings'], ['daily', 'daily.action=past-day']], 'test runs are only counted by the server, and the 21st event is cut');
  });

  it('usage.view is a permission an admin can hold', () => {
    assert.ok(PERMISSION_IDS.includes('usage.view'));
  });
});
