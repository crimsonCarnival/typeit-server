import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { connectDB } from './src/config/database.js';
import { router as routes } from './src/routes/index.js';
import { logger } from './src/middleware/logger.middleware.js';
import { PORT, NODE_ENV, CORS_ORIGINS } from './src/config/env.js';
import { attachRaceSocket } from './src/sockets/race.socket.js';
import { startNotificationScheduler } from './src/services/notification-scheduler.js';
import { applyConfiguredRoles } from './src/services/bootstrap-roles.js';
import { startChangelogSchedule } from './src/services/changelog.service.js';
import { startUsageCompaction } from './src/services/usage.service.js';
import { errorHandler, notFound, sanitizeBody, securityHeaders } from './src/middleware/security.middleware.js';
import { rateLimit } from './src/middleware/rateLimit.middleware.js';

const app = express();

// Trust the proxy so req.ip reflects the client's IP (not Render's proxy IP).
// Needed for rate limiting and security checks behind Render/Vercel.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);

// Allow an explicit allowlist via CORS_ORIGINS; otherwise default to local dev
// origins (localhost on any port + dev tunnels). Production never falls back:
// anyone can open a dev tunnel, so without CORS_ORIGINS no origin is allowed.
const defaultOrigins = NODE_ENV === 'production' ? [] : [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, /\.devtunnels\.ms$/];
if (NODE_ENV === 'production' && CORS_ORIGINS.length === 0) {
  console.warn('[cors] CORS_ORIGINS is not set: browsers on other origins (and the race socket) will be refused.');
}
const isAllowedOrigin = (origin) =>
  CORS_ORIGINS.length > 0
    ? CORS_ORIGINS.includes(origin)
    : defaultOrigins.some((pattern) => pattern.test(origin));
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
};

app.use(cors(corsOptions));
// Raised from the 100kb default: /game/end carries a keystroke log
// (bounded by MAX_KEYSTROKES) plus per-second performance samples.
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use(sanitizeBody);
// The verbose logger prints every body (keystroke logs included): dev only.
if (NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
  app.use(logger);
}

// Broad per-IP budget for the whole API; sensitive routes add their own.
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 600 }));
app.use('/api', routes);
app.use('/api', notFound);
app.use(errorHandler);

// Start the HTTP server immediately; connect to MongoDB in the background so a
// slow/unavailable database does not block the health endpoint.
const server = app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT} (${NODE_ENV})`);
});

// Live races share the HTTP port (WebSocket upgrade on /ws/race) with the
// same origin policy as CORS.
attachRaceSocket(server, isAllowedOrigin);
startNotificationScheduler();
startChangelogSchedule();
startUsageCompaction();

connectDB()
  // A failure here must not take the server down: the roles can be fixed in the admin area.
  .then(() => applyConfiguredRoles().catch((err) => console.error('[roles] could not apply server settings:', err?.message || err)))
  .catch((err) => {
  console.error('[server] initial DB connection failed:', err?.message || err);
  if (NODE_ENV === 'production') {
    process.exit(1);
  }
});
