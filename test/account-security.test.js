import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../src/models/user.model.js';
import { GOOGLE_CLIENT_ID, JWT_SECRET } from '../src/config/env.js';
import { generateToken, tokenIsCurrent } from '../src/services/auth.service.js';
import {
  AccountError,
  USERNAME_CHANGE_DAYS,
  changeUsername,
  nextUsernameChange,
  setEmail,
  setPassword,
  setStreakOffset,
  unlinkGoogle,
} from '../src/services/account-security.service.js';
import { GoogleAuthError, checkIdentity, clientReturnUrl, completeGoogle, linkWithTicket, readState } from '../src/services/google-auth.service.js';

const id = () => new mongoose.Types.ObjectId();
const DAY = 86_400_000;
const query = (value) => {
  const q = Promise.resolve(value);
  q.select = () => q;
  q.lean = async () => value;
  return q;
};

describe('session tokens', () => {
  it('carry the token version, and stop working once it is bumped', () => {
    const user = { _id: id(), tokenVersion: 3 };
    const decoded = jwt.verify(generateToken(user), JWT_SECRET);
    assert.equal(decoded.tv, 3);
    assert.equal(tokenIsCurrent(decoded, user), true);
    assert.equal(tokenIsCurrent(decoded, { tokenVersion: 4 }), false, 'revoked');
  });

  it('tokens from before versions existed still match an account that never revoked', () => {
    assert.equal(tokenIsCurrent({ userId: 'x' }, { tokenVersion: 0 }), true);
    assert.equal(tokenIsCurrent({ userId: 'x' }, {}), true);
    assert.equal(tokenIsCurrent({ userId: 'x' }, { tokenVersion: 1 }), false);
  });
});

describe('passwords and email', () => {
  afterEach(() => mock.restoreAll());
  const account = async (password) => {
    const doc = { password: password ? await bcrypt.hash(password, 4) : null, googleId: 'g1', save: mock.fn(async () => {}) };
    mock.method(User, 'findById', () => query(doc));
    return doc;
  };

  it('a Google-only account can add a password without a current one', async () => {
    const doc = await account(null);
    await setPassword(id(), { next: 'new-password-1' });
    assert.ok(await bcrypt.compare('new-password-1', doc.password));
  });

  it('changing a password needs the current one', async () => {
    await account('old-password-1');
    await assert.rejects(setPassword(id(), { current: 'wrong', next: 'new-password-1' }), (e) => e instanceof AccountError && e.status === 403);
    await setPassword(id(), { current: 'old-password-1', next: 'new-password-1' });
  });

  it('changing the email needs the password, and a free address', async () => {
    const doc = await account('pw-123456');
    mock.method(User, 'exists', async () => null);
    await assert.rejects(setEmail(id(), { password: 'nope', email: 'a@b.co' }), /wrong/);
    await setEmail(id(), { password: 'pw-123456', email: ' New@Example.com ' });
    assert.equal(doc.email, 'new@example.com');
    mock.method(User, 'exists', async () => ({ _id: 1 }));
    await assert.rejects(setEmail(id(), { password: 'pw-123456', email: 'taken@x.co' }), /already/);
  });

  it('Google cannot be unlinked from an account with no password (it would be locked out)', async () => {
    await account(null);
    await assert.rejects(unlinkGoogle(id()), /Add a password first/);
  });
});

describe('username changes', () => {
  afterEach(() => mock.restoreAll());
  const now = new Date('2026-10-28T12:00:00Z');

  it('are allowed again only after 30 days', () => {
    assert.equal(nextUsernameChange(null, now), null);
    assert.ok(nextUsernameChange(new Date(now - 29 * DAY), now));
    assert.equal(nextUsernameChange(new Date(now - USERNAME_CHANGE_DAYS * DAY), now), null);
  });

  it('are refused inside the window, and for a taken or malformed name', async () => {
    mock.method(User, 'findById', () => query({ username: 'ana', usernameChangedAt: new Date(now - 5 * DAY) }));
    await assert.rejects(changeUsername(id(), 'anna', now), (e) => e.status === 429);
    mock.method(User, 'findById', () => query({ username: 'ana', usernameChangedAt: null }));
    mock.method(User, 'exists', async () => ({ _id: 1 }));
    await assert.rejects(changeUsername(id(), 'bob', now), /taken/);
    await assert.rejects(changeUsername(id(), 'no spaces', now), /letters/);
  });
});

describe('streak offset', () => {
  afterEach(() => mock.restoreAll());

  it('can only be set once, and only to whole hours in range', async () => {
    let set = false;
    mock.method(User, 'updateOne', async (filter) => {
      assert.equal(filter.streakOffsetSetAt, null, 'only when not set yet');
      const modifiedCount = set ? 0 : 1;
      set = true;
      return { modifiedCount };
    });
    await setStreakOffset(id(), -3);
    await assert.rejects(setStreakOffset(id(), 2), /already/);
    for (const bad of [13, -12, 1.5, '2']) await assert.rejects(setStreakOffset(id(), bad), /whole number/);
  });
});

describe('Google sign-in', () => {
  afterEach(() => mock.restoreAll());

  it('rejects a forged or expired state', () => {
    assert.throws(() => readState('not-a-jwt'), GoogleAuthError);
    const forged = jwt.sign({ n: 'x'.repeat(20), m: 'login' }, 'another-secret', { audience: 'typeit:google-state' });
    assert.throws(() => readState(forged), GoogleAuthError);
    const wrongAudience = jwt.sign({ n: 'x'.repeat(20), m: 'login' }, JWT_SECRET);
    assert.throws(() => readState(wrongAudience), GoogleAuthError, 'a session token is not a state');
  });

  it('only accepts an ID token issued for this app, fresh, with a verified email', () => {
    const good = { aud: GOOGLE_CLIENT_ID, iss: 'accounts.google.com', sub: '123', exp: String(Math.floor(Date.now() / 1000) + 60), email: 'A@X.com', email_verified: 'true' };
    assert.equal(checkIdentity(good).email, 'a@x.com');
    assert.throws(() => checkIdentity({ ...good, aud: `${GOOGLE_CLIENT_ID}-someone-else` }), GoogleAuthError);
    assert.throws(() => checkIdentity({ ...good, iss: 'evil.example' }), GoogleAuthError);
    assert.throws(() => checkIdentity({ ...good, exp: '1' }), GoogleAuthError);
    assert.throws(() => checkIdentity({ ...good, email_verified: 'false' }), /email-unverified/);
  });

  it('does not take over an existing account that has the same email', async () => {
    mock.method(User, 'findOne', async () => null);
    mock.method(User, 'exists', async () => ({ _id: 1 }));
    const create = mock.method(User, 'create', async () => ({}));
    await assert.rejects(completeGoogle({ mode: 'login' }, { sub: 'g1', email: 'a@x.com', name: '' }), /email-in-use/);
    assert.equal(create.mock.callCount(), 0);
  });

  it('the callback never links: it only issues a ticket for the user who started it', async () => {
    const update = mock.method(User, 'findOneAndUpdate', () => query({}));
    const userId = String(id());
    const out = await completeGoogle({ mode: 'link', userId }, { sub: 'g1', email: 'a@x.com' });
    assert.ok(out.ticket);
    assert.equal(update.mock.callCount(), 0);
    assert.equal(jwt.decode(out.ticket).u, userId);
  });

  it('a ticket only links the account it was issued for (a link URL sent to someone else does nothing)', async () => {
    const attacker = String(id());
    const { ticket } = await completeGoogle({ mode: 'link', userId: attacker }, { sub: 'victim-google', email: 'v@x.com' });
    const update = mock.method(User, 'findOneAndUpdate', () => query({}));
    mock.method(User, 'findOne', () => query(null));
    await assert.rejects(linkWithTicket(String(id()), ticket), /bad-request/);
    assert.equal(update.mock.callCount(), 0);
    await linkWithTicket(attacker, ticket);
    assert.equal(update.mock.callCount(), 1);
  });

  it('will not link a Google account already linked elsewhere, or with a forged ticket', async () => {
    const userId = String(id());
    const { ticket } = await completeGoogle({ mode: 'link', userId }, { sub: 'g1', email: 'a@x.com' });
    mock.method(User, 'findOne', () => query({ _id: id() }));
    await assert.rejects(linkWithTicket(userId, ticket), /google-in-use/);
    const forged = jwt.sign({ u: userId, g: 'g1', e: 'a@x.com' }, 'other-secret', { audience: 'typeit:google-link' });
    await assert.rejects(linkWithTicket(userId, forged), /expired/);
  });

  it('signs in a returning Google user, and refuses a banned one', async () => {
    const user = { _id: id(), tokenVersion: 0, status: 'active' };
    mock.method(User, 'findOne', async () => user);
    assert.ok(jwt.verify((await completeGoogle({ mode: 'login' }, { sub: 'g1', email: 'a@x.com', name: '' })).token, JWT_SECRET).userId);
    user.status = 'banned';
    await assert.rejects(completeGoogle({ mode: 'login' }, { sub: 'g1', email: 'a@x.com', name: '' }), /banned/);
  });

  it('returns the token in the fragment, never the query string', () => {
    const url = clientReturnUrl({ token: 't', nonce: 'n' });
    assert.ok(url.includes('/auth/google#token=t&nonce=n'));
    assert.equal(new URL(url).search, '');
  });
});

describe('the user as sent to a client', () => {
  it('says whether a password exists, but never sends the hash, the Google id or the token version', () => {
    const json = new User({ username: 'ana_1', email: 'a@x.co', password: 'hash', googleId: 'g', tokenVersion: 2 }).toJSON();
    assert.equal(json.hasPassword, true);
    for (const k of ['password', 'googleId', 'tokenVersion']) assert.equal(k in json, false, k);
    assert.equal(new User({ username: 'ana_2', email: 'b@x.co', password: null }).toJSON().hasPassword, false);
  });
});
