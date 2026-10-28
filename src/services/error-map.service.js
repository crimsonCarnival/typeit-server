import mongoose from 'mongoose';
import { generate } from 'random-words';
import Result from '../models/result.model.js';
import {
  DRILL_CANDIDATES,
  DRILL_WORD_COUNT,
  ERROR_MAP_DIGRAPH_LIMIT,
  TRENDS_KEY_LIMIT,
  WEAK_DIGRAPH_LIMIT,
  WEAK_KEY_LIMIT,
  WEAK_MIN_PRESSES,
  WEAK_WORD_COUNT,
  WEAK_WORD_SHARE,
} from '../config/error-map.js';

const add = (map, key, n) => map.set(key, (map.get(key) || 0) + n);

/**
 * Sums per-run key statistics into one map. Pure.
 *
 * @param {Array<{keyPresses?:Array, keyErrors?:Array, digraphErrors?:Array}>} runs
 * @returns {{
 *   runs: number,
 *   totalPresses: number,
 *   keys: Array<{key:string, presses:number, errors:number, errorRate:number,
 *                typedInstead:Array<{typed:string, count:number}>}>,
 *   digraphs: Array<{pair:string, errors:number}>,
 * }}
 */
export const aggregateErrorMap = (runs) => {
  const presses = new Map();
  const errors = new Map();
  const instead = new Map(); // expected -> Map(typed -> count)
  const digraphs = new Map();

  for (const run of runs) {
    for (const { key, count } of run.keyPresses || []) add(presses, key, count);
    for (const { expected, typed, count } of run.keyErrors || []) {
      add(errors, expected, count);
      if (!instead.has(expected)) instead.set(expected, new Map());
      add(instead.get(expected), typed, count);
    }
    for (const { pair, count } of run.digraphErrors || []) add(digraphs, pair, count);
  }

  const keys = [...presses].map(([key, p]) => {
    const e = errors.get(key) || 0;
    return {
      key,
      presses: p,
      errors: e,
      errorRate: p ? Number(((e / p) * 100).toFixed(1)) : 0,
      typedInstead: [...(instead.get(key) || [])]
        .map(([typed, count]) => ({ typed, count }))
        .sort((a, b) => b.count - a.count),
    };
  });

  return {
    runs: runs.length,
    totalPresses: [...presses.values()].reduce((a, b) => a + b, 0),
    keys: keys.sort((a, b) => b.errors - a.errors || a.key.localeCompare(b.key)),
    digraphs: [...digraphs]
      .map(([pair, e]) => ({ pair, errors: e }))
      .sort((a, b) => b.errors - a.errors || a.pair.localeCompare(b.pair))
      .slice(0, ERROR_MAP_DIGRAPH_LIMIT),
  };
};

/** Error map over the player's `runs` most recent runs that carry key data. */
export const getErrorMap = async (userId, runs) => {
  const recent = await Result.find({
    userId: new mongoose.Types.ObjectId(String(userId)),
    'keyPresses.0': { $exists: true },
  })
    .sort({ createdAt: -1 })
    .limit(runs)
    .select('keyPresses keyErrors digraphErrors')
    .lean();
  return aggregateErrorMap(recent);
};

/**
 * Builds drill text: words that contain `target` (a key or a two-letter
 * digraph). Spaces are drilled with short words, which maximise word breaks.
 *
 * @param {string} target
 * @param {() => string[]} [candidates] word source (injectable for tests)
 */
export const buildDrillText = (target, candidates = () => generate({ exactly: DRILL_CANDIDATES, maxLength: 9 })) => {
  const pool = candidates();
  const t = target.toLowerCase();
  let words = t === ' ' ? pool.filter((w) => w.length <= 4) : pool.filter((w) => w.includes(t));
  // Rare targets (q, z, uncommon pairs) may yield few words: repeat them
  // rather than pad with unrelated ones.
  if (words.length === 0) words = pool;
  const picked = [];
  for (let i = 0; picked.length < DRILL_WORD_COUNT; i++) picked.push(words[i % words.length]);
  const text = picked.join(' ');
  return { text, totalWords: picked.length };
};

/**
 * The player's weakest keys (highest error rate among keys pressed often
 * enough to judge) and digraphs, from an aggregated error map. Spaces are
 * left out: every word already ends in one.
 */
export const weakTargets = (map) => ({
  keys: map.keys
    .filter((k) => k.key !== ' ' && k.errors > 0 && k.presses >= WEAK_MIN_PRESSES)
    .sort((a, b) => b.errorRate - a.errorRate || b.errors - a.errors)
    .slice(0, WEAK_KEY_LIMIT)
    .map((k) => k.key),
  digraphs: map.digraphs
    .filter((d) => !d.pair.includes(' '))
    .slice(0, WEAK_DIGRAPH_LIMIT)
    .map((d) => d.pair),
});

/**
 * Practice text weighted toward weak keys and digraphs: about
 * WEAK_WORD_SHARE of the words contain one, the rest are ordinary words so
 * the run still reads like a normal test.
 *
 * @param {{keys: string[], digraphs: string[]}} targets
 * @param {() => string[]} [candidates]  word source (injectable for tests)
 * @param {() => number} [random]
 */
export const buildWeakKeysText = (
  { keys, digraphs },
  candidates = () => generate({ exactly: DRILL_CANDIDATES, maxLength: 9 }),
  random = Math.random
) => {
  const pool = candidates();
  const targets = [...digraphs, ...keys].map((t) => t.toLowerCase());
  const weak = pool.filter((w) => targets.some((t) => w.includes(t)));
  const plain = pool.filter((w) => !targets.some((t) => w.includes(t)));
  const words = [];
  for (let i = 0; i < WEAK_WORD_COUNT; i++) {
    const source = weak.length && (random() < WEAK_WORD_SHARE || !plain.length) ? weak : plain.length ? plain : pool;
    words.push(source[Math.floor(random() * source.length)]);
  }
  return { text: words.join(' '), totalWords: words.length };
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday 00:00 UTC of the week containing `date`, as 'YYYY-MM-DD'. */
export const weekStart = (date) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
};

/**
 * Weekly error trends. Pure: buckets runs (newest `weeks` weeks, oldest
 * first, empty weeks included) by week, with the overall error rate, the
 * average WPM and the error rate of the keys that are weakest overall.
 */
export const weeklyTrends = (runs, weeks, now = new Date()) => {
  const starts = Array.from({ length: weeks }, (_, i) => weekStart(new Date(now.getTime() - (weeks - 1 - i) * 7 * DAY_MS)));
  const buckets = new Map(starts.map((w) => [w, { week: w, runs: [], presses: 0, errors: 0, wpm: 0 }]));
  for (const run of runs) {
    const bucket = buckets.get(weekStart(new Date(run.createdAt)));
    if (!bucket) continue;
    bucket.runs.push(run);
    bucket.wpm += run.wpm || 0;
    for (const { count } of run.keyPresses || []) bucket.presses += count;
    for (const { count } of run.keyErrors || []) bucket.errors += count;
  }

  const overall = aggregateErrorMap(runs);
  const keys = weakTargets(overall).keys.slice(0, TRENDS_KEY_LIMIT);
  const rate = (e, p) => (p ? Number(((e / p) * 100).toFixed(1)) : null);

  return {
    keys,
    weeks: [...buckets.values()].map((b) => {
      const perKey = aggregateErrorMap(b.runs).keys;
      return {
        week: b.week,
        runs: b.runs.length,
        presses: b.presses,
        errors: b.errors,
        errorRate: rate(b.errors, b.presses),
        wpm: b.runs.length ? Math.round(b.wpm / b.runs.length) : null,
        keys: Object.fromEntries(keys.map((k) => {
          const entry = perKey.find((x) => x.key === k);
          return [k, entry ? rate(entry.errors, entry.presses) : null];
        })),
      };
    }),
  };
};

/** Error trends over the player's last `weeks` weeks. */
export const getErrorTrends = async (userId, weeks, now = new Date()) => {
  const since = new Date(`${weekStart(new Date(now.getTime() - (weeks - 1) * 7 * DAY_MS))}T00:00:00Z`);
  const runs = await Result.find({
    userId: new mongoose.Types.ObjectId(String(userId)),
    createdAt: { $gte: since },
    'keyPresses.0': { $exists: true },
  })
    .select('keyPresses keyErrors digraphErrors wpm createdAt')
    .lean();
  return weeklyTrends(runs, weeks, now);
};
