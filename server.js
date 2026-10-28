import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { connectDB } from './src/config/database.js';
import { router as routes } from './src/routes/index.js';
import { logger } from './src/middleware/logger.middleware.js';
import { PORT, NODE_ENV, CORS_ORIGINS } from './src/config/env.js';

const app = express();

// Trust the proxy so req.ip reflects the client's IP (not Render's proxy IP).
// Needed for rate limiting and security checks behind Render/Vercel.
app.set('trust proxy', 1);

// Allow an explicit allowlist via CORS_ORIGINS; otherwise default to local dev
// origins (localhost on any port + dev tunnels).
const defaultOrigins = [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, /\.devtunnels\.ms$/];
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed =
      CORS_ORIGINS.length > 0
        ? CORS_ORIGINS.includes(origin)
        : defaultOrigins.some((pattern) => pattern.test(origin));
    if (allowed) {
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
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(logger);

app.use('/api', routes);

// Start the HTTP server immediately; connect to MongoDB in the background so a
// slow/unavailable database does not block the health endpoint.
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT} (${NODE_ENV})`);
});

connectDB().catch((err) => {
  console.error('[server] initial DB connection failed:', err?.message || err);
  if (NODE_ENV === 'production') {
    process.exit(1);
  }
});
