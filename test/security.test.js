import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripUnsafeKeys } from '../src/middleware/security.middleware.js';
import { checkAvatar, checkEmail, checkPassword, checkTimezone, checkUsername, parseGameSettings } from '../src/utils/validate.js';
import { clampInt, errorMessage } from '../src/utils/http.js';

describe('stripUnsafeKeys', () => {
  it('drops operator, dotted and prototype keys at any depth', () => {
    const body = JSON.parse('{"email":{"$ne":null},"a.b":1,"__proto__":{"x":1},"ok":[{"$gt":1,"keep":2}],"n":3}');
    assert.deepEqual(stripUnsafeKeys(body), { email: {}, ok: [{ keep: 2 }], n: 3 });
  });
});

describe('account validation', () => {
  it('accepts sane values', () => {
    assert.equal(checkUsername('crimson_1'), null);
    assert.equal(checkEmail('a@b.co'), null);
    assert.equal(checkPassword('secret1'), null);
    assert.equal(checkAvatar('https://example.com/a.png'), null);
    assert.equal(checkTimezone('Europe/Madrid'), null);
  });
  it('rejects bad values', () => {
    assert.ok(checkUsername({ $ne: null }));
    assert.ok(checkUsername('no spaces'));
    assert.ok(checkEmail('nope'));
    assert.ok(checkPassword('short'));
    assert.ok(checkPassword('x'.repeat(73)));
    assert.ok(checkAvatar('javascript:alert(1)'));
    assert.ok(checkTimezone('Mars/Olympus'));
  });
});

describe('parseGameSettings', () => {
  it('keeps absent fields absent', () => {
    assert.deepEqual(parseGameSettings({}).settings, {});
  });
  it('rejects out-of-range and mistyped settings', () => {
    assert.ok(parseGameSettings({ wordCount: 1e8 }).error);
    assert.ok(parseGameSettings({ timeMax: 0 }).error);
    assert.ok(parseGameSettings({ gameMode: 'zen' }).error);
    assert.ok(parseGameSettings({ punctuationEnabled: 'yes' }).error);
    assert.ok(parseGameSettings({ clientText: 'x'.repeat(20001) }).error);
  });
  it('passes valid settings through', () => {
    assert.deepEqual(parseGameSettings({ gameMode: 'words', wordCount: 50, timeMax: 60, numbersEnabled: true }).settings,
      { gameMode: 'words', wordCount: 50, timeMax: 60, numbersEnabled: true });
  });
});

describe('http helpers', () => {
  it('clamps integers', () => {
    assert.equal(clampInt('999999', 10, 1, 100), 100);
    assert.equal(clampInt('abc', 10, 1, 100), 10);
    assert.equal(clampInt(['5'], 10, 1, 100), 5);
  });
  it('keeps 4xx messages and hides nothing in dev', () => {
    assert.equal(errorMessage(new Error('Username taken'), 409), 'Username taken');
  });
});

describe('settings validation', async () => {
  const { parseSettingsPatch } = await import('../src/utils/validate.js');

  it('accepts known settings with allowed values', () => {
    assert.deepEqual(parseSettingsPatch({ theme: 'light', spaceSkips: true }).settings, { theme: 'light', spaceSkips: true });
  });

  it('rejects unknown keys, bad values and non-objects', () => {
    // Themes are a client catalog: any well-formed id is accepted, anything else is not.
    assert.deepEqual(parseSettingsPatch({ theme: 'nord-light' }), { settings: { theme: 'nord-light' } });
    for (const bad of ['Neon!', '', 'a'.repeat(33), 42, { $gt: '' }, '<script>']) assert.ok(parseSettingsPatch({ theme: bad }).error, String(bad));
    assert.ok(parseSettingsPatch({ caretStyle: 'neon' }).error);
    assert.ok(parseSettingsPatch({ $set: { role: 'admin' } }).error);
    assert.ok(parseSettingsPatch(['theme']).error);
    assert.ok(parseSettingsPatch(null).error);
  });
});

describe('number-range settings', async () => {
  const { parseSettingsPatch: parse } = await import('../src/utils/validate.js');
  it('accept whole numbers in range, and 0 to switch a minimum off', () => {
    assert.deepEqual(parse({ paceCaretWpm: 120 }), { settings: { paceCaretWpm: 120 } });
    assert.deepEqual(parse({ minWpm: 0, minAccuracy: 95 }), { settings: { minWpm: 0, minAccuracy: 95 } });
    for (const bad of [{ paceCaretWpm: 5 }, { paceCaretWpm: 120.5 }, { paceCaretWpm: '120' }, { minWpm: 5 }, { minAccuracy: 101 }, { minAccuracy: 40 }]) assert.ok(parse(bad).error, JSON.stringify(bad));
  });
});

describe('settings keys from the prototype', async () => {
  const { parseSettingsPatch: parse } = await import('../src/utils/validate.js');
  it('are unknown settings, never validators', () => {
    for (const key of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
      const body = JSON.parse(`{"${key}": {"polluted": true}}`);
      assert.ok(parse(body).error, key);
    }
  });
});
