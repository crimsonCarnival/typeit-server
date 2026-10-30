/**
 * Anonymous usage statistics (see config/usage.js for what is counted).
 *
 * A browser sends a random visitor id. Only a keyed hash of it is stored, in a
 * per-day set per feature, so "how many different people" is the size of the
 * union of those sets over a range. No IP, account or raw id is ever written.
 */
import crypto from 'crypto';
import UsageDay from '../models/usage-day.model.js';
import { JWT_SECRET } from '../config/env.js';
import { BOT_SPEEDS, CLIENT_USAGE_EVENTS, USAGE_BY_KEY, USAGE_EVENTS_PER_REQUEST, USAGE_NEW_IDS_PER_IP } from '../config/usage.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Derived from the JWT secret so no extra setting is needed; rotating either resets distinct counting.
const HASH_KEY = process.env.USAGE_HASH_SECRET || crypto.createHmac('sha256', JWT_SECRET).update('usage-v1').digest();

/** 'YYYY-MM-DD' of a moment, in UTC. */
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** The stored form of a visitor id, or null when it isn't a UUID v4. */
export const hashVisitor = (id) =>
  typeof id === 'string' && UUID.test(id) ? crypto.createHmac('sha256', HASH_KEY).update(id.toLowerCase()).digest('hex').slice(0, 32) : null;

// IP → hashes it brought in today. Memory only, so a restart forgets it.
let capDay = '';
let seenByIp = new Map();

/** Whether an IP may count this visitor today: known ones always, new ones up to the cap. */
export const admitVisitor = (ip, hash, now = Date.now()) => {
  const day = utcDay(now);
  if (day !== capDay) {
    capDay = day;
    seenByIp = new Map();
  }
  let seen = seenByIp.get(ip);
  if (!seen) seenByIp.set(ip, (seen = new Set()));
  if (seen.has(hash)) return true;
  if (seen.size >= USAGE_NEW_IDS_PER_IP) return false;
  seen.add(hash);
  return true;
};

export const _resetCap = () => {
  capDay = '';
  seenByIp = new Map();
};

/** The stored keys for one event: the feature, then 'feature.dim=value' per catalogued detail. */
export const usageKeys = (key, dims = {}) => {
  const entry = USAGE_BY_KEY[key];
  if (!entry) return [];
  const keys = [key];
  for (const [dim, spec] of Object.entries(entry.dims ?? {})) {
    if (dims[dim] === undefined || dims[dim] === null) continue;
    const value = String(dims[dim]);
    keys.push(`${key}.${dim}=${spec.values.includes(value) ? value : 'other'}`);
  }
  return keys;
};

/**
 * Counts one use of a feature. Callers don't await it: it never throws and a
 * failure only loses a count.
 * @param {{ visitorId: unknown, ip: string, user: { usageOptOut?: boolean } | null, key: string,
 *           dims?: Record<string, unknown>, finished?: boolean, now?: number }} event
 */
export const record = async ({ visitorId, ip, user, key, dims, finished = false, now = Date.now() }) => {
  try {
    if (user?.usageOptOut) return;
    const keys = usageKeys(key, dims);
    const hash = hashVisitor(visitorId);
    if (!keys.length || !hash || !admitVisitor(ip, hash, now)) return;
    const side = user ? 'user' : 'guest';
    const day = utcDay(now);
    const update = finished
      ? { $inc: { [`finished.${side}`]: 1 } }
      : { $inc: { [`times.${side}`]: 1 }, $addToSet: { [`visitors.${side}`]: hash } };
    await UsageDay.bulkWrite(keys.map((k) => ({ updateOne: { filter: { day, key: k }, update, upsert: true } })), { ordered: false });
  } catch (err) {
    console.error('[usage] not recorded:', err?.message || err);
  }
};

/**
 * Events the browser reports itself (page views, opening a past daily day).
 * Only listed keys are kept, at most USAGE_EVENTS_PER_REQUEST per call, each
 * key once per call. Fire-and-forget like record().
 */
export const recordClientEvents = ({ visitorId, events, ip, user, now = Date.now() }) => {
  if (!Array.isArray(events)) return;
  const keys = new Set();
  for (const event of events.slice(0, USAGE_EVENTS_PER_REQUEST)) {
    if (typeof event?.key === 'string' && CLIENT_USAGE_EVENTS.has(event.key)) keys.add(event.key);
  }
  for (const key of keys) {
    const usage = key === 'daily:past-day' ? { key: 'daily', dims: { action: 'past-day' } } : { key };
    void record({ visitorId, ip, user, ...usage, now });
  }
};

const PRACTICE_KINDS = { drill: 'drills', 'weak-keys': 'drills', 'common-words': 'common-words', review: 'review', list: 'word-lists' };
const MODIFIERS = (run) => (run.punctuationEnabled ? (run.numbersEnabled ? 'both' : 'punctuation') : run.numbersEnabled ? 'numbers' : 'none');
const roomBucket = (n) => (n >= 5 ? '5+' : n >= 3 ? '3-4' : '2');

/**
 * Which feature a run belongs to. Daily, practice and race runs count only in
 * their own rows, so the test rows mean "free play in this mode".
 * @param {object} run  a session or guest run
 * @param {{ botWpm?: unknown, roomSize?: number, phase?: 'start'|'finish' }} [extra]
 */
export const runUsage = (run, { botWpm, roomSize, phase = 'start' } = {}) => {
  const kind = run.practice?.kind;
  if (kind === 'ghost') return { key: 'daily', dims: { action: 'ghost' } };
  if (run.dailyDate) return { key: 'daily', dims: { action: 'attempt' } };
  if (kind === 'lesson') return { key: 'lessons', dims: { lesson: run.practice.id } };
  if (kind) return { key: 'practice', dims: { kind: PRACTICE_KINDS[kind] ?? kind } };
  if (run.raceCode) {
    return { key: 'race.live', dims: { action: phase === 'finish' ? 'finished' : 'started', ...(roomSize ? { size: roomBucket(roomSize) } : {}) } };
  }
  if (BOT_SPEEDS.includes(botWpm)) return { key: 'race.bot', dims: { speed: botWpm } };
  if (run.gameMode === 'phrases') return { key: 'test.phrases', dims: { category: run.textCategory } };
  if (run.gameMode === 'code') return { key: 'test.code', dims: { language: run.codeLanguage, time: run.timeMax } };
  return { key: 'test.words', dims: { words: run.wordCount, time: run.timeMax, language: run.language, modifiers: MODIFIERS(run) } };
};
