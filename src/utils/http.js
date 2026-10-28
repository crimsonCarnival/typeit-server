import { NODE_ENV } from '../config/env.js';

const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * Message to send for a failed request. Client errors (4xx) carry their own
 * message; server errors are logged and replaced by a generic one so
 * internals (stack details, query errors) never reach the client.
 */
export const errorMessage = (error, status = 500) => {
  if (status < 500) return error?.message || 'Bad request';
  console.error('[server]', error?.stack || error);
  return NODE_ENV === 'production' ? GENERIC_ERROR : error?.message || GENERIC_ERROR;
};

/**
 * Parses an integer query/body value and clamps it to [min, max]; anything
 * unparseable falls back to `fallback`.
 */
export const clampInt = (value, fallback, min, max) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};

/** A single string from a query/body value (express may give arrays). */
export const asString = (value) => (typeof value === 'string' ? value : undefined);
