import helmet from 'helmet';
import { errorMessage } from '../utils/http.js';

/**
 * Security headers for a JSON API: no HTML is served, so the CSP denies
 * everything and the API may be read cross-origin (CORS still decides who).
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

/**
 * Removes keys that MongoDB would read as operators or paths ("$ne",
 * "a.b") and prototype-polluting keys from a parsed body, recursively. Stops
 * `{ "email": { "$ne": null } }` style injection into queries built from
 * request fields.
 */
export const stripUnsafeKeys = (value, depth = 0) => {
  if (depth > 20) return undefined;
  if (Array.isArray(value)) return value.map((v) => stripUnsafeKeys(v, depth + 1));
  if (!isPlainObject(value)) return value;
  const clean = {};
  for (const [key, v] of Object.entries(value)) {
    if (key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    clean[key] = stripUnsafeKeys(v, depth + 1);
  }
  return clean;
};

export const sanitizeBody = (req, res, next) => {
  if (req.body && typeof req.body === 'object') req.body = stripUnsafeKeys(req.body);
  next();
};

/** JSON 404 for unknown API routes. */
export const notFound = (req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
};

/**
 * Last-resort error handler: malformed JSON and oversized bodies become 4xx
 * responses, anything else a generic 500 (logged, never echoed).
 */
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Malformed JSON body' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'Request body too large' });
  }
  if (err?.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, error: 'Origin not allowed' });
  }
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ success: false, error: errorMessage(err, status) });
};
