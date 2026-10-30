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
import {
  BOT_SPEEDS,
  CLIENT_USAGE_EVENTS,
  USAGE_BY_KEY,
  USAGE_CATALOGUE,
  USAGE_EVENTS_PER_REQUEST,
  USAGE_NEW_IDS_PER_IP,
  USAGE_SET_RETENTION_DAYS,
} from '../config/usage.js';

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

// ---------------------------------------------------------------------------
// Reading the statistics (admin Usage page)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const dayAt = (day) => Date.parse(`${day}T00:00:00Z`);
const shift = (day, n) => utcDay(dayAt(day) + n * DAY_MS);

/** The `range` days ending today, and the same number of days before them. */
export const rangeDays = (range, now = Date.now()) => {
  const end = utcDay(now);
  const curStart = shift(end, 1 - range);
  const prevStart = shift(curStart, -range);
  const days = Array.from({ length: range }, (_, i) => shift(curStart, i));
  return { end, curStart, prevStart, days, prevDays: Array.from({ length: range }, (_, i) => shift(prevStart, i)) };
};

/** Chart buckets: one per day, or for 90 days one per Monday–Sunday week (the first may be shorter). */
export const buckets = (range, now = Date.now()) => {
  const { days } = rangeDays(range, now);
  if (range < 90) return days.map((d) => ({ start: d, end: d, days: [d] }));
  const out = [];
  for (const d of days) {
    if (!out.length || new Date(dayAt(d)).getUTCDay() === 1) out.push({ start: d, end: d, days: [] });
    const b = out.at(-1);
    b.days.push(d);
    b.end = d;
  }
  return out;
};

/**
 * Per key over the given days: distinct people (union of the daily hash sets),
 * times and finishes. Compacted days have no sets left, so their daily counts
 * are added as they are.
 */
export const tally = (docs, days) => {
  const wanted = new Set(days);
  const acc = {};
  for (const d of docs) {
    if (!wanted.has(d.day)) continue;
    const a = (acc[d.key] ??= { g: new Set(), u: new Set(), extra: { guest: 0, user: 0, all: 0 }, times: { guest: 0, user: 0 }, finished: { guest: 0, user: 0 } });
    for (const h of d.visitors?.guest ?? []) a.g.add(h);
    for (const h of d.visitors?.user ?? []) a.u.add(h);
    if (d.people) for (const side of ['guest', 'user', 'all']) a.extra[side] += d.people[side] ?? 0;
    for (const side of ['guest', 'user']) {
      a.times[side] += d.times?.[side] ?? 0;
      a.finished[side] += d.finished?.[side] ?? 0;
    }
  }
  return Object.fromEntries(Object.entries(acc).map(([key, a]) => [key, {
    guests: a.g.size + a.extra.guest,
    signedIn: a.u.size + a.extra.user,
    all: new Set([...a.g, ...a.u]).size + a.extra.all,
    times: a.times,
    finished: a.finished,
  }]));
};

/** People in the previous period, or null when the key wasn't tracked for all of it. */
export const previous = (counts, firstSeen, prevStart) => (firstSeen && firstSeen <= prevStart ? counts?.all ?? 0 : null);

const WHO = { all: 'all', guests: 'guests', 'signed-in': 'signedIn' };
const timesFor = (t, side) => (side === 'guests' ? t.guest : side === 'signedIn' ? t.user : t.guest + t.user);

/** First day each key was recorded. */
const firstSeenByKey = async () => {
  const rows = await UsageDay.aggregate([{ $group: { _id: '$key', first: { $min: '$day' } } }]);
  return Object.fromEntries(rows.map((r) => [r._id, r.first]));
};

const loadDays = (from, to, keys) =>
  UsageDay.find({ day: { $gte: from, $lte: to }, ...(keys ? { key: { $in: keys } } : {}) })
    .select('day key times finished visitors people')
    .lean();

/**
 * The catalogue as rows with this period's numbers and the previous period's people.
 * @param {{ range: number, who?: 'all'|'guests'|'signed-in', now?: number }} q
 */
export const summary = async ({ range, who = 'all', now = Date.now() }) => {
  const r = rangeDays(range, now);
  const [docs, firstSeen] = await Promise.all([loadDays(r.prevStart, r.end), firstSeenByKey()]);
  const cur = tally(docs, r.days);
  const prev = tally(docs, r.prevDays);
  const side = WHO[who] ?? 'all';
  const zero = { guest: 0, user: 0 };
  const row = (key, label) => {
    const c = cur[key];
    return {
      key,
      label,
      people: c?.[side] ?? 0,
      guests: c?.guests ?? 0,
      signedIn: c?.signedIn ?? 0,
      times: timesFor(c?.times ?? zero, side),
      finished: timesFor(c?.finished ?? zero, side),
      prev: previous(prev[key] && { all: prev[key][side] }, firstSeen[key] ?? null, r.prevStart),
      firstSeen: firstSeen[key] ?? null,
    };
  };
  const rows = USAGE_CATALOGUE.map((e) => ({
    ...row(e.key, e.label),
    group: e.group,
    account: !!e.account,
    finish: !!e.finish,
    children: Object.entries(e.dims ?? {}).map(([dim, spec]) => {
      const values = [...spec.values, ...(cur[`${e.key}.${dim}=other`] ? ['other'] : [])];
      return { dim, label: spec.label, rows: values.map((v) => row(`${e.key}.${dim}=${v}`, spec.labels?.[v] ?? (v === 'other' ? 'Other' : v))) };
    }),
  }));
  return { range, who, start: r.curStart, end: r.end, rows };
};

/** 'Words test · 30' for 'test.words.time=30'. */
const labelOf = (key) => {
  const at = key.lastIndexOf('.', key.indexOf('=') === -1 ? key.length : key.indexOf('='));
  const [base, detail] = key.includes('=') ? [key.slice(0, at), key.slice(at + 1)] : [key, null];
  const entry = USAGE_BY_KEY[base];
  if (!entry) return key;
  if (!detail) return entry.label;
  const [dim, value] = detail.split('=');
  return `${entry.label} · ${entry.dims?.[dim]?.labels?.[value] ?? (value === 'other' ? 'Other' : value)}`;
};

/** Every key the series endpoint accepts: features and their details. */
export const seriesKeys = () =>
  new Set(USAGE_CATALOGUE.flatMap((e) => [e.key, ...Object.entries(e.dims ?? {}).flatMap(([dim, s]) => [...s.values, 'other'].map((v) => `${e.key}.${dim}=${v}`))]));

/**
 * People per bucket for the given keys. A bucket that ends before the key was
 * first seen is null (not tracked yet), not zero.
 * @param {{ keys: string[], range: number, who?: string, now?: number }} q
 */
export const series = async ({ keys, range, who = 'all', now = Date.now() }) => {
  const list = buckets(range, now);
  const [docs, firstSeen] = await Promise.all([loadDays(list[0].start, list.at(-1).end, keys), firstSeenByKey()]);
  const side = WHO[who] ?? 'all';
  return {
    buckets: list.map(({ start, end }) => ({ start, end })),
    lines: keys.map((key) => {
      const own = docs.filter((d) => d.key === key);
      return {
        key,
        label: labelOf(key),
        data: list.map((b) => (!firstSeen[key] || b.end < firstSeen[key] ? null : tally(own, b.days)[key]?.[side] ?? 0)),
      };
    }),
  };
};

/** Drops the hashed visitor sets of days past retention, keeping each day's distinct counts. */
export const compact = async (now = Date.now()) => {
  const cutoff = shift(utcDay(now), -USAGE_SET_RETENTION_DAYS);
  const size = (path) => ({ $size: { $ifNull: [path, []] } });
  await UsageDay.updateMany({ day: { $lt: cutoff }, visitors: { $exists: true } }, [
    {
      $set: {
        people: {
          guest: size('$visitors.guest'),
          user: size('$visitors.user'),
          all: { $size: { $setUnion: [{ $ifNull: ['$visitors.guest', []] }, { $ifNull: ['$visitors.user', []] }] } },
        },
      },
    },
    { $unset: 'visitors' },
  ]);
};

/** Compacts shortly after start, then once a day. */
export const startUsageCompaction = () => {
  const run = () => compact().catch((err) => console.error('[usage] compaction failed:', err?.message || err));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, DAY_MS).unref();
};
