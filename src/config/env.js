import crypto from 'crypto';
import 'dotenv/config';

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const PORT = parseInt(process.env.PORT, 10) || 3000;
export const MONGO_URI = process.env.MONGO_URI || '';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// JWT secret is mandatory in production; the server fails closed rather than
// signing tokens with a known public string.
// In development we use an ephemeral random secret so the process can run
// without configuration (tokens simply become invalid on restart).
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[env] JWT_SECRET not set; using an ephemeral dev-only secret.');
}
export const JWT_SECRET = jwtSecret;

// Google sign-in. All three must be set for it to be offered. The redirect
// URI is this server's callback as registered in the Google console, e.g.
// https://example.com/api/auth/google/callback. CLIENT_URL is where the browser
// goes back to afterwards.
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
export const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';
export const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:4200';

// Release notes are compiled from these GitHub repos ("owner/name", comma-separated).
// The token is optional for public repos; for private ones use a fine-grained
// token with read-only "Contents" access to just these repos.
export const GITHUB_CHANGELOG_REPOS = (process.env.GITHUB_CHANGELOG_REPOS || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => /^[\w.-]+\/[\w.-]+$/.test(s));
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// Public contact address shown on the About page (empty hides the contact options).
export const CONTACT_EMAIL = (process.env.CONTACT_EMAIL || '').trim();

// Accounts that hold a role because the server's settings say so, not because
// someone granted it in the app (comma-separated).
//   FOUNDER_USER_IDS / FOUNDER_USERNAMES  the top rank: can't be changed, banned or deleted through the app
//   ADMIN_USER_IDS / ADMIN_USERNAMES      admins; promoted when the server starts, never demoted by it
// Prefer the *_USER_IDS settings: an id (from the database) can't be claimed by registering
// a name. A username is only safe once its account exists, and is refused if it matches more
// than one account. Only existing, active accounts are promoted.
const usernameList = (value) =>
  (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
export const FOUNDER_USERNAMES = usernameList(process.env.FOUNDER_USERNAMES);
export const ADMIN_USERNAMES = usernameList(process.env.ADMIN_USERNAMES);
const idList = (value) => usernameList(value).filter((id) => /^[a-f0-9]{24}$/i.test(id));
export const FOUNDER_USER_IDS = idList(process.env.FOUNDER_USER_IDS);
export const ADMIN_USER_IDS = idList(process.env.ADMIN_USER_IDS);

// Allowed CORS origins. Defaults to local dev origins; override via CORS_ORIGINS
// (comma-separated) once the app is deployed to a real domain.
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
