import {
  AccountError,
  changeUsername,
  optOutOfLeaderboards,
  resetPersonalBests,
  revokeAllSessions,
  setEmail,
  setPassword,
  setStreakOffset,
  unlinkGoogle,
  checkCanLinkGoogle,
} from '../services/account-security.service.js';
import { BlockError, block, listBlocked, unblock } from '../services/block.service.js';
import { GoogleAuthError, googleAuthUrl, googleEnabled, handleGoogleCallback, linkWithTicket } from '../services/google-auth.service.js';

const fail = (res, error) => {
  if (error instanceof AccountError || error instanceof BlockError) return res.status(error.status).json({ success: false, error: error.message });
  if (error instanceof GoogleAuthError) return res.status(error.code === 'not-configured' ? 503 : error.code === 'google-in-use' ? 409 : 400).json({ success: false, error: error.code });
  console.error('[account]', error?.message || error);
  return res.status(500).json({ success: false, error: 'Something went wrong' });
};

/**
 * Runs an account action and answers { success: true } or the reason it was
 * refused. Actions that change a sign-in method return a fresh session token.
 */
const action = (run) => async (req, res) => {
  try {
    const out = await run(req);
    res.json({ success: true, data: { done: true, ...(typeof out === 'string' ? { token: out } : out?.token ? { token: out.token } : {}) } });
  } catch (error) {
    fail(res, error);
  }
};

const accountController = {
  /** GET /api/auth/google/enabled */
  googleEnabled: (req, res) => res.json({ success: true, data: { enabled: googleEnabled() } }),

  /** POST /api/auth/google/url  { mode: 'login'|'link', nonce } */
  googleUrl: async (req, res) => {
    try {
      const mode = ['link', 'reauth'].includes(req.body?.mode) ? req.body.mode : 'login';
      if (mode !== 'login' && !req.user) return res.status(401).json({ success: false, error: 'Sign in first' });
      // Linking adds a lasting way in: it needs the password, not just a session.
      if (mode === 'link') await checkCanLinkGoogle(req.userId, req.body?.password);
      res.json({ success: true, data: { url: googleAuthUrl({ mode, nonce: req.body?.nonce, userId: req.user?._id }) } });
    } catch (error) {
      fail(res, error);
    }
  },

  /** GET /api/auth/google/callback?code&state — Google sends the browser here. */
  googleCallback: async (req, res) => {
    const target = await handleGoogleCallback({ code: req.query.code, state: req.query.state, error: req.query.error });
    res.set('Referrer-Policy', 'no-referrer');
    res.redirect(302, target);
  },

  /** POST /api/auth/google/link  { ticket } — the signed-in user finishes linking Google. */
  linkGoogle: action((req) => linkWithTicket(req.userId, req.body?.ticket)),
  unlinkGoogle: action((req) => unlinkGoogle(req.userId)),
  setPassword: action((req) => setPassword(req.userId, { current: req.body?.current, next: req.body?.next, reauth: req.body?.reauth })),
  setEmail: action((req) => setEmail(req.userId, { password: req.body?.password, email: req.body?.email })),
  revokeAll: action((req) => revokeAllSessions(req.userId)),
  changeUsername: action((req) => changeUsername(req.userId, req.body?.username)),
  setStreakOffset: action((req) => setStreakOffset(req.userId, req.body?.hours)),
  optOut: action((req) => optOutOfLeaderboards(req.userId)),
  resetPersonalBests: action((req) => resetPersonalBests(req.userId)),
  block: action((req) => block(req.userId, req.params.userId)),
  unblock: action((req) => unblock(req.userId, req.params.userId)),

  /** GET /api/users/blocks */
  listBlocks: async (req, res) => {
    try {
      res.json({ success: true, data: { users: await listBlocked(req.userId) } });
    } catch (error) {
      fail(res, error);
    }
  },
};

export default accountController;
