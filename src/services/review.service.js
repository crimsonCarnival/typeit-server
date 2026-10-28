import DigraphReview from '../models/digraph-review.model.js';
import { buildDrillText } from './error-map.service.js';
import {
  REVIEW_INTERVAL_DAYS,
  REVIEW_MAX_BOX,
  REVIEW_MIN_CLEAN,
  REVIEW_PAIRS_PER_RUN,
  REVIEW_WORD_COUNT,
} from '../config/learn.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const isLetterPair = (pair) => /^[a-z]{2}$/i.test(pair);

/** How often each letter pair occurs in `text` (case-insensitive). */
export const pairCounts = (text) => {
  const counts = new Map();
  const lower = text.toLowerCase();
  for (let i = 1; i < lower.length; i++) {
    const pair = lower[i - 1] + lower[i];
    if (isLetterPair(pair)) counts.set(pair, (counts.get(pair) || 0) + 1);
  }
  return counts;
};

/**
 * What a finished run means for the review queue. Pure.
 *
 * @param {Array<{pair:string, box:number, dueAt:Date}>} queue   the player's queue
 * @param {{ digraphErrors: Array<{pair:string,count:number}>, typedText: string }} run
 * @returns {{ missed: string[], promote: Array<{pair:string, box:number, dueAt:Date}>, retire: string[] }}
 */
export const reviewOutcome = (queue, { digraphErrors, typedText }, now = new Date()) => {
  const missed = [...new Set(digraphErrors.map((d) => d.pair.toLowerCase()).filter(isLetterPair))];
  const missedSet = new Set(missed);
  const counts = pairCounts(typedText);
  const promote = [];
  const retire = [];
  for (const item of queue) {
    if (missedSet.has(item.pair) || item.dueAt > now || (counts.get(item.pair) || 0) < REVIEW_MIN_CLEAN) continue;
    if (item.box >= REVIEW_MAX_BOX) retire.push(item.pair);
    else promote.push({ pair: item.pair, box: item.box + 1, dueAt: new Date(now.getTime() + REVIEW_INTERVAL_DAYS[item.box + 1] * DAY_MS) });
  }
  return { missed, promote, retire };
};

/**
 * Updates the player's queue after a run: missed pairs go (back) to box 1
 * and are due now; due pairs typed cleanly move up a box.
 */
export const recordReviewRun = async (userId, run, now = new Date()) => {
  const queue = await DigraphReview.find({ userId }).select('pair box dueAt').lean();
  const { missed, promote, retire } = reviewOutcome(queue, run, now);
  const ops = [
    ...missed.map((pair) => ({
      updateOne: {
        filter: { userId, pair },
        update: { $set: { box: 1, dueAt: now }, $inc: { misses: 1 } },
        upsert: true,
      },
    })),
    ...promote.map(({ pair, box, dueAt }) => ({ updateOne: { filter: { userId, pair }, update: { $set: { box, dueAt } } } })),
    ...retire.map((pair) => ({ deleteOne: { filter: { userId, pair } } })),
  ];
  if (ops.length) await DigraphReview.bulkWrite(ops, { ordered: false });
};

/** The player's queue summary for the Learn page. */
export const getReviewOverview = async (userId, now = new Date()) => {
  const queue = await DigraphReview.find({ userId }).sort({ dueAt: 1, misses: -1 }).select('pair box dueAt').lean();
  const due = queue.filter((q) => q.dueAt <= now);
  return {
    total: queue.length,
    due: due.length,
    duePairs: due.slice(0, REVIEW_PAIRS_PER_RUN).map((q) => q.pair),
    nextDueAt: queue.find((q) => q.dueAt > now)?.dueAt ?? null,
  };
};

/**
 * Practice text for the due pairs: words containing them, shared out
 * evenly. Null when nothing is due.
 */
export const buildReviewText = (pairs, candidates) => {
  if (!pairs.length) return null;
  const per = Math.max(1, Math.ceil(REVIEW_WORD_COUNT / pairs.length));
  const words = pairs.flatMap((pair) => buildDrillText(pair, candidates).text.split(' ').slice(0, per));
  // Interleave so one pair doesn't fill the start of the run.
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  const picked = words.slice(0, REVIEW_WORD_COUNT);
  return { text: picked.join(' '), totalWords: picked.length };
};
