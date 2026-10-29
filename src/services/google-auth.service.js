import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';
import { CLIENT_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, JWT_SECRET } from '../config/env.js';
import { JWT_VERIFY_OPTIONS, generateToken } from './auth.service.js';
import { USERNAME_PATTERN } from '../utils/public-identity.js';
import { notify } from './notification.service.js';

/*
 * "Sign in with Google" using the authorization-code flow, server side:
 *
 * 1. The client asks for a URL (POST /auth/google/url) with a random nonce it
 *    keeps in sessionStorage. The server signs a short-lived `state` holding
 *    the nonce, the mode (login or link) and, to link, the signed-in user.
 * 2. Google sends the browser to GOOGLE_REDIRECT_URI with a code and that state.
 * 3. The server checks the state's signature, exchanges the code, checks the
 *    ID token Google returns (audience, issuer, verified email, expiry), and
 *    sends the browser back to the client with the session token and the
 *    nonce in the URL fragment (never sent to any server, never logged).
 * 4. The client only accepts the token if the nonce is the one it kept, so a
 *    login can't be forced on someone from another browser.
 *
 * Linking never happens in the callback: it returns a short-lived signed link
 * ticket instead, which the signed-in client posts back with its own session
 * and the nonce (POST /auth/google/link). A link URL started by someone else
 * and opened by a victim therefore links nothing: the victim's browser lacks
 * the nonce, and the ticket names the other account, not the victim's session.
 */

const STATE_TTL = '10m';
const STATE_AUDIENCE = 'typeit:google-state';
const TICKET_AUDIENCE = 'typeit:google-link';
const TICKET_TTL = '5m';
const REAUTH_AUDIENCE = 'typeit:google-reauth';
const MODES = ['login', 'link', 'reauth'];
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** A refused sign-in: `code` goes back to the client, which explains it. */
export class GoogleAuthError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const googleEnabled = () => !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);

const NONCE = /^[A-Za-z0-9_-]{16,128}$/;

/** The Google consent URL for a login, or to link Google to `userId`. */
export const googleAuthUrl = ({ mode, nonce, userId = null }) => {
  if (!googleEnabled()) throw new GoogleAuthError('not-configured');
  if (!NONCE.test(String(nonce))) throw new GoogleAuthError('bad-request');
  if (!MODES.includes(mode)) throw new GoogleAuthError('bad-request');
  if (mode !== 'login' && !userId) throw new GoogleAuthError('bad-request');
  const state = jwt.sign({ n: nonce, m: mode, u: userId ? String(userId) : null }, JWT_SECRET, {
    expiresIn: STATE_TTL,
    audience: STATE_AUDIENCE,
    algorithm: 'HS256',
  });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
};

export const readState = (state) => {
  try {
    return jwt.verify(String(state), JWT_SECRET, { ...JWT_VERIFY_OPTIONS, audience: STATE_AUDIENCE });
  } catch {
    throw new GoogleAuthError('expired');
  }
};

/** Exchanges the code and returns the checked Google identity: { sub, email, name, picture }. */
const googleIdentity = async (code, fetchImpl = fetch) => {
  const tokenRes = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: String(code), client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: GOOGLE_REDIRECT_URI, grant_type: 'authorization_code' }),
  });
  if (!tokenRes.ok) throw new GoogleAuthError('google-failed');
  const { id_token: idToken } = await tokenRes.json();
  if (!idToken) throw new GoogleAuthError('google-failed');
  // Google checks the signature; we check that the token is for this app and fresh.
  const infoRes = await fetchImpl(`${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`);
  if (!infoRes.ok) throw new GoogleAuthError('google-failed');
  const info = await infoRes.json();
  return checkIdentity(info);
};

/** Validates what Google says about the ID token. Pure, for tests. */
export const checkIdentity = (info, now = Date.now()) => {
  if (info.aud !== GOOGLE_CLIENT_ID) throw new GoogleAuthError('google-failed');
  if (!GOOGLE_ISSUERS.includes(info.iss)) throw new GoogleAuthError('google-failed');
  if (!info.sub || Number(info.exp) * 1000 < now) throw new GoogleAuthError('google-failed');
  if (String(info.email_verified) !== 'true' || !info.email) throw new GoogleAuthError('email-unverified');
  return { sub: String(info.sub), email: String(info.email).toLowerCase(), name: info.name ? String(info.name) : '', picture: info.picture ? String(info.picture) : '' };
};

/** A free username from the email's local part, e.g. "jane.doe" or "jane.doe_4821". */
const freeUsername = async (email) => {
  const base = (email.split('@')[0].replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 14) || 'player').padEnd(3, '0');
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}_${crypto.randomInt(1000, 9999)}`;
    if (USERNAME_PATTERN.test(candidate) && !(await User.exists({ username: candidate }))) return candidate;
  }
  return `player_${crypto.randomBytes(4).toString('hex')}`;
};

/**
 * Signs in (or up) with a Google identity, or links it to the signed-in user.
 * Returns the session token for a login, or null for a link.
 *
 * An existing account with the same email but no Google link is not taken
 * over automatically: whoever registered that email may not own it, so the
 * owner has to sign in with their password and link Google from settings.
 */
export const completeGoogle = async ({ mode, userId }, identity) => {
  if (mode === 'reauth') {
    // Proves the signed-in player still controls the Google account linked to them.
    const user = await User.findOne({ _id: userId, status: 'active' }).select('googleId');
    if (!user?.googleId || user.googleId !== identity.sub) throw new GoogleAuthError('wrong-google');
    return { reauth: jwt.sign({ u: String(userId) }, JWT_SECRET, { expiresIn: TICKET_TTL, audience: REAUTH_AUDIENCE, algorithm: 'HS256' }) };
  }

  if (mode === 'link') {
    // Only a ticket here; the signed-in client completes the link (linkWithTicket).
    return { ticket: jwt.sign({ u: String(userId), g: identity.sub, e: identity.email }, JWT_SECRET, { expiresIn: TICKET_TTL, audience: TICKET_AUDIENCE, algorithm: 'HS256' }) };
  }

  let user = await User.findOne({ googleId: identity.sub });
  if (!user) {
    if (await User.exists({ email: identity.email })) throw new GoogleAuthError('email-in-use');
    user = await User.create({
      username: await freeUsername(identity.email),
      displayName: identity.name.slice(0, 30),
      email: identity.email,
      password: null,
      googleId: identity.sub,
      googleEmail: identity.email,
    });
  }
  if (user.status === 'banned') throw new GoogleAuthError('banned');
  if (user.status === 'deactivated') throw new GoogleAuthError('deactivated');
  return { token: generateToken(user) };
};

/** Where the browser goes after Google, with the outcome in the fragment. */
export const clientReturnUrl = (fields) => `${CLIENT_URL.replace(/\/$/, '')}/auth/google#${new URLSearchParams(fields)}`;

/** The whole callback: code + state in, return URL out. Never throws. */
export const handleGoogleCallback = async ({ code, state, error }, fetchImpl = fetch) => {
  let nonce = '';
  try {
    const s = readState(state);
    nonce = s.n;
    if (error || !code) throw new GoogleAuthError('cancelled');
    const identity = await googleIdentity(code, fetchImpl);
    const out = await completeGoogle({ mode: s.m, userId: s.u }, identity);
    const fields = out.ticket ? { ticket: out.ticket } : out.reauth ? { reauth: out.reauth } : { token: out.token };
    return clientReturnUrl({ ...fields, nonce });
  } catch (err) {
    const code = err instanceof GoogleAuthError ? err.code : 'google-failed';
    if (!(err instanceof GoogleAuthError)) console.error('[google] sign-in failed:', err?.message || err);
    return clientReturnUrl({ error: code, nonce });
  }
};

/**
 * Completes a link for the signed-in user from a ticket the callback issued.
 * The ticket must have been issued for this very user, and not have expired.
 */
export const linkWithTicket = async (userId, ticket) => {
  let t;
  try {
    t = jwt.verify(String(ticket), JWT_SECRET, { ...JWT_VERIFY_OPTIONS, audience: TICKET_AUDIENCE });
  } catch {
    throw new GoogleAuthError('expired');
  }
  if (String(t.u) !== String(userId)) throw new GoogleAuthError('bad-request');
  const owner = await User.findOne({ googleId: t.g }).select('_id');
  if (owner && String(owner._id) !== String(userId)) throw new GoogleAuthError('google-in-use');
  const user = await User.findOneAndUpdate({ _id: userId, status: 'active' }, { $set: { googleId: t.g, googleEmail: t.e }, $inc: { tokenVersion: 1 } }, { new: true });
  if (!user) throw new GoogleAuthError('no-account');
  await notify(userId, { type: 'account', title: 'Google sign-in was added to your account', body: `${t.e}. Other devices were signed out. If this wasn't you, change your password and remove it.`, link: '/account?tab=authentication' });
  return { token: generateToken(user) };
};

/** Whether a re-authentication ticket from the Google flow is valid for this user. */
export const reauthValid = (userId, ticket) => {
  try {
    return String(jwt.verify(String(ticket), JWT_SECRET, { ...JWT_VERIFY_OPTIONS, audience: REAUTH_AUDIENCE }).u) === String(userId);
  } catch {
    return false;
  }
};
