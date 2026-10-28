import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { USERNAME_PATTERN, publicHandle, publicName } from '../src/utils/public-identity.js';

const id = '650000000000000000001234';

describe('public identity', () => {
  it('hides names that are emails', () => {
    const user = { _id: id, username: 'steban@gmail.com', displayName: 'steban@gmail.com' };
    assert.equal(publicHandle(user), 'player1234');
    assert.equal(publicName(user), 'player1234');
  });

  it('keeps ordinary names and prefers the display name', () => {
    const user = { _id: id, username: 'crimson', displayName: 'Crimson Carnival' };
    assert.equal(publicHandle(user), 'crimson');
    assert.equal(publicName(user), 'Crimson Carnival');
    assert.equal(publicName({ _id: id, username: 'crimson', displayName: '' }), 'crimson');
  });

  it('only accepts handle-shaped usernames', () => {
    assert.ok(USERNAME_PATTERN.test('crimson_9'));
    assert.ok(!USERNAME_PATTERN.test('a@b.com'));
    assert.ok(!USERNAME_PATTERN.test('ab'));
    assert.ok(!USERNAME_PATTERN.test('has space'));
  });
});
