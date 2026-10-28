/**
 * Minimal in-memory rate limiter (fixed window) keyed by IP, or by user when
 * the request is authenticated. Each limiter keeps its own counters, so a
 * strict limiter (auth) never shares a budget with a loose one (the API at
 * large). Not a substitute for a distributed limiter, but sufficient for a
 * single instance.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 20;
const CLEANUP_MS = 60 * 1000;

const limiters = new Set();

const ipOf = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

/**
 * @param {object} [options]
 * @param {number} [options.windowMs]
 * @param {number} [options.max]          requests allowed per window
 * @param {boolean} [options.perUser]     key on the signed-in user when known
 *                                        (mount after auth/optionalAuth)
 */
export const rateLimit = ({ windowMs = WINDOW_MS, max = MAX_REQUESTS, perUser = false } = {}) => {
  const hits = new Map();
  limiters.add({ hits, windowMs });

  return (req, res, next) => {
    const key = perUser && req.userId ? `u:${req.userId}` : `ip:${ipOf(req)}`;
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now - entry.startedAt >= windowMs) {
      hits.set(key, { startedAt: now, count: 1 });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.startedAt + windowMs - now) / 1000)));
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please try again later.',
      });
    }

    next();
  };
};

// Opportunistic cleanup so the maps never grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const { hits, windowMs } of limiters) {
    for (const [key, entry] of hits) {
      if (now - entry.startedAt >= windowMs) hits.delete(key);
    }
  }
}, CLEANUP_MS).unref();
