/**
 * Minimal in-memory rate limiter (sliding window) keyed by IP.
 * Guards auth endpoints against brute-force attempts. Not a substitute for a
 * distributed limiter, but sufficient for this app's current scale.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 20;

const hits = new Map();

const keyOf = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

export const rateLimit = ({ windowMs = WINDOW_MS, max = MAX_REQUESTS } = {}) => {
  return (req, res, next) => {
    const key = keyOf(req);
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now - entry.startedAt >= windowMs) {
      hits.set(key, { startedAt: now, count: 1 });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please try again later.',
      });
    }

    next();
  };
};

// Opportunistic cleanup so the map never grows unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) {
    if (now - entry.startedAt >= WINDOW_MS) hits.delete(key);
  }
}, WINDOW_MS).unref();
