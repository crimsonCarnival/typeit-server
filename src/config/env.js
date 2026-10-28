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

// Allowed CORS origins. Defaults to local dev origins; override via CORS_ORIGINS
// (comma-separated) once the app is deployed to a real domain.
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
