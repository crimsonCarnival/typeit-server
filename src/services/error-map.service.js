import mongoose from 'mongoose';
import { generate } from 'random-words';
import Result from '../models/result.model.js';
import { DRILL_CANDIDATES, DRILL_WORD_COUNT, ERROR_MAP_DIGRAPH_LIMIT } from '../config/error-map.js';

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
