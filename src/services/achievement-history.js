import {
  BREAKTHROUGH_GAIN,
  COMEBACK_KID_GAP_DAYS,
  COMEBACK_KID_RUNS,
  COMEBACK_PB_DAYS,
  FLAWLESS_MIN_CORRECT_CHARS,
  KEY_ERROR_DROP,
  KEY_MIN_PRESSES,
  METRONOME_BAND,
  METRONOME_RUNS,
  METRONOME_SECONDS,
  MIN_BADGE_ACCURACY,
  PERFECT_STORM_SECONDS,
  PERFECT_STORM_WPM,
  PHOTO_FINISH_MARGIN,
  QUALIFYING_ACCURACY,
  TRIPLE_THREAT_RUNS,
} from '../config/achievements.js';
import { WEAK_MIN_PRESSES } from '../config/error-map.js';
import { GAME_MODES } from '../utils/validate.js';

/*
 * Metrics that need a player's run history or race history, not just totals.
 * Everything here is pure: callers pass runs oldest first, so the same
 * history always gives the same answer (re-evaluating never double counts).
 *
 * A run: { createdAt, wpm, accuracy, successes, elapsedTime, timeMax, gameMode,
 *   wordCount, modifiers, language, textCategory, ranked, practiceKind,
 *   practiceId, dailyDate, completionPercentage, penalty, keyPresses, keyErrors }
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const time = (d) => new Date(d).getTime();
// Thresholds are fractions (1.1x, 5%), so exact boundaries need a little float tolerance.
const EPS = 1e-9;

/** Verified normal test: practice and daily runs are excluded. */
export const isEligible = (r) => !!r.ranked && !r.practiceKind && !r.dailyDate;

/**
 * What makes two runs comparable: everything that changes difficulty. Two
 * runs share a personal best only when all of these match.
 */
export const configKey = (r) =>
  [
    r.gameMode,
    r.gameMode === 'words' ? r.wordCount : '',
    r.timeMax,
    r.modifiers || 'none',
    r.language || '',
    r.gameMode === 'phrases' ? r.textCategory || '' : '',
  ].join('|');

/**
 * Each eligible run with the best the player had in its configuration just
 * before it (null for the first run there), and whether it beat that best.
 * Equalling a best is not beating it.
 */
export const personalBestEvents = (runs) => {
  const best = new Map();
  const events = [];
  for (const run of runs) {
    if (!isEligible(run)) continue;
    const key = configKey(run);
    const prev = best.get(key) ?? null;
    const isPb = !!prev && run.wpm > prev.wpm;
    events.push({ run, key, prev, isPb });
    if (!prev || run.wpm > prev.wpm) best.set(key, { wpm: run.wpm, at: time(run.createdAt) });
  }
  return events;
};

/** Personal bests that beat the previous one by BREAKTHROUGH_GAIN or more at good accuracy. */
export const countBreakthroughs = (events) =>
  events.filter((e) => e.isPb && e.run.wpm >= e.prev.wpm * (1 + BREAKTHROUGH_GAIN) - EPS && e.run.accuracy >= MIN_BADGE_ACCURACY).length;

/** Personal bests that ended a record standing for COMEBACK_PB_DAYS or more. */
export const countOldRecordsBroken = (events) =>
  events.filter((e) => e.isPb && time(e.run.createdAt) - e.prev.at >= COMEBACK_PB_DAYS * DAY_MS).length;

/**
 * Personal bests that finished the whole text with under a second of the
 * time limit left. Elapsed time is stored in whole seconds, so "limit minus
 * penalties minus elapsed" of 0 or 1 is the last second.
 */
export const countClockFinishes = (events) =>
  events.filter((e) => {
    const { run } = e;
    const left = run.timeMax - (run.penalty?.seconds || 0) - run.elapsedTime;
    return e.isPb && run.completionPercentage >= 100 && left >= 0 && left <= 1;
  }).length;

/**
 * Longest chain of consecutive verified runs that were each a personal best in
 * a configuration not yet used in the chain. A run that is not a new best
 * ends the chain; a best in an already-used configuration restarts it.
 */
export const longestMomentumChain = (events) => {
  let chain = new Set();
  let longest = 0;
  for (const e of events) {
    if (!e.isPb) chain = new Set();
    else if (chain.has(e.key)) chain = new Set([e.key]);
    else chain.add(e.key);
    longest = Math.max(longest, chain.size);
  }
  return longest;
};

/**
 * Longest run of consecutive verified 60s tests, each at MIN_BADGE_ACCURACY or
 * better, whose speeds sit within METRONOME_BAND: (fastest - slowest) / mean.
 * Other kinds of test in between neither help nor break the sequence.
 * Capped at METRONOME_RUNS.
 */
export const longestMetronome = (runs) => {
  const sixty = runs.filter((r) => isEligible(r) && r.timeMax === METRONOME_SECONDS);
  let longest = 0;
  for (let i = 0; i < sixty.length; i++) {
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    let len = 0;
    for (let j = i; j < sixty.length && len < METRONOME_RUNS; j++) {
      const r = sixty[j];
      if (r.accuracy < MIN_BADGE_ACCURACY) break;
      lo = Math.min(lo, r.wpm);
      hi = Math.max(hi, r.wpm);
      sum += r.wpm;
      if ((hi - lo) / (sum / (len + 1)) > METRONOME_BAND + EPS) break;
      len++;
    }
    longest = Math.max(longest, len);
  }
  return longest;
};

/**
 * Longest streak of verified runs at 100% accuracy. Runs too short for 100% to
 * mean anything are ignored (they neither count nor break the streak); a
 * long-enough run below 100% breaks it. Capped at TRIPLE_THREAT_RUNS.
 */
export const longestPerfectStreak = (runs) => {
  let current = 0;
  let longest = 0;
  for (const r of runs) {
    if (!isEligible(r) || r.successes < FLAWLESS_MIN_CORRECT_CHARS) continue;
    current = r.accuracy >= 100 ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return Math.min(longest, TRIPLE_THREAT_RUNS);
};

/** Verified runs that hit the speed and 100% accuracy together, in one run (not across runs). */
export const countPerfectStorms = (runs) =>
  runs.filter((r) => isEligible(r) && r.timeMax === PERFECT_STORM_SECONDS && r.wpm >= PERFECT_STORM_WPM && r.accuracy >= 100).length;

/** Verified runs at good accuracy with the given modifier combinations on. */
export const countModifierRuns = (runs, modifiers) =>
  runs.filter((r) => isEligible(r) && r.accuracy >= MIN_BADGE_ACCURACY && modifiers.includes(r.modifiers)).length;

/**
 * Well-Traveled progress in tests: the count of verified tests, held one short
 * of the target until they span enough configurations.
 */
export const wellTraveledProgress = (runs, target, minConfigs) => {
  const eligible = runs.filter(isEligible);
  const configs = new Set(eligible.map(configKey)).size;
  const count = Math.min(eligible.length, target);
  return configs >= minConfigs ? count : Math.min(count, target - 1);
};

/** A finished normal test at decent accuracy (verified or not: other modes and languages are never ranked). */
const isQualifying = (r) =>
  !r.practiceKind && !r.dailyDate && (r.ranked || r.completionPercentage >= 100) && r.accuracy >= QUALIFYING_ACCURACY;

/** How many of the game's modes the player has finished a qualifying test in. */
export const countModesPlayed = (runs) => new Set(runs.filter((r) => isQualifying(r) && GAME_MODES.includes(r.gameMode)).map((r) => r.gameMode)).size;

/** Distinct words-test languages with a qualifying test (runs from before languages were stored have none). */
export const countLanguagesPlayed = (runs) =>
  new Set(runs.filter((r) => isQualifying(r) && r.gameMode === 'words' && r.language).map((r) => r.language)).size;

const dayNumber = (d) => Math.floor(time(d) / DAY_MS);

/**
 * Comeback Kid progress: after a stretch of at least COMEBACK_KID_GAP_DAYS
 * calendar days with no test (UTC days, like the play streak), how many tests
 * the player has finished since coming back, capped at the target. The best
 * return counts. A player's first ever test is not a return.
 */
export const comebackProgress = (runs) => {
  let best = 0;
  for (let i = 1; i < runs.length; i++) {
    const daysWithout = dayNumber(runs[i].createdAt) - dayNumber(runs[i - 1].createdAt) - 1;
    if (daysWithout >= COMEBACK_KID_GAP_DAYS) best = Math.max(best, Math.min(COMEBACK_KID_RUNS, runs.length - i));
  }
  return best;
};

const addCounts = (map, list, field) => {
  for (const item of list || []) {
    const key = field === 'key' ? item.key : item.expected;
    if (typeof key === 'string' && key.length === 1) map.set(key, (map.get(key) || 0) + (item.count || 0));
  }
};

/**
 * Keys whose mistakes fell after a drill on them. For each single-key drill,
 * the key must have been among the player's three weakest at that moment
 * (highest error rate, with enough presses to judge), and its error rate over
 * all runs after the drill must be KEY_ERROR_DROP lower than before it, with
 * KEY_MIN_PRESSES samples on both sides. Distinct keys are counted once.
 *
 * (Accuracy gain is measured as error-rate reduction: a 20% relative gain in
 * accuracy is impossible once accuracy is above 83%.)
 */
export const countImprovedKeys = (runs) => {
  const presses = new Map();
  const errors = new Map();
  const drills = [];
  for (const r of runs) {
    const before = { presses: new Map(presses), errors: new Map(errors) };
    addCounts(presses, r.keyPresses, 'key');
    addCounts(errors, r.keyErrors, 'expected');
    if (r.practiceKind === 'drill' && typeof r.practiceId === 'string' && r.practiceId.length === 1) {
      drills.push({ key: r.practiceId, before, through: { p: presses.get(r.practiceId) || 0, e: errors.get(r.practiceId) || 0 } });
    }
  }

  const improved = new Set();
  for (const d of drills) {
    const beforeP = d.before.presses.get(d.key) || 0;
    const beforeE = d.before.errors.get(d.key) || 0;
    const afterP = (presses.get(d.key) || 0) - d.through.p;
    const afterE = (errors.get(d.key) || 0) - d.through.e;
    if (beforeP < KEY_MIN_PRESSES || afterP < KEY_MIN_PRESSES || beforeE === 0) continue;

    const weakest = [...d.before.presses]
      .filter(([k, p]) => p >= WEAK_MIN_PRESSES && (d.before.errors.get(k) || 0) > 0)
      .sort((a, b) => (d.before.errors.get(b[0]) || 0) / b[1] - (d.before.errors.get(a[0]) || 0) / a[1])
      .slice(0, 3)
      .map(([k]) => k);
    if (!weakest.includes(d.key)) continue;

    if (afterE / afterP <= (beforeE / beforeP) * (1 - KEY_ERROR_DROP)) improved.add(d.key);
  }
  return improved.size;
};

/*
 * Race badges. A race: { players: [{ userId, place, finishedAt, ranked, reached75At }],
 * mode, winnerId, startAt, finishedAt }, oldest first. Only persisted races
 * exist, so cancelled and abandoned rooms never appear. Races with fewer than
 * two racers (a self-race) are not valid.
 */

const MIN_RACERS = 2;

const validRaces = (races, userId) =>
  races.filter((r) => r.players.length >= MIN_RACERS && r.players.some((p) => String(p.userId) === userId));

const isWin = (race, userId) => String(race.winnerId) === userId;

/**
 * Longest run of consecutive wins. A loss (or not finishing) resets it. A race
 * with no verified winner is neither a win nor a loss.
 */
export const longestWinStreak = (races, userId) => {
  let current = 0;
  let longest = 0;
  for (const race of validRaces(races, userId)) {
    if (!race.winnerId) continue;
    current = isWin(race, userId) ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
};

const mine = (race, userId) => race.players.find((p) => String(p.userId) === userId);

/**
 * Wins where the runner-up finished within PHOTO_FINISH_MARGIN of the winner's
 * own time (start to finish). Timed races are decided by speed, not by who
 * finishes first, so they are skipped. A dead heat counts (margin 0).
 */
export const countPhotoFinishes = (races, userId) =>
  validRaces(races, userId).filter((race) => {
    if (race.mode === 'time' || !isWin(race, userId)) return false;
    const winner = mine(race, userId);
    if (!winner?.finishedAt || !race.startAt) return false;
    const winnerTime = time(winner.finishedAt) - time(race.startAt);
    const others = race.players.filter((p) => String(p.userId) !== userId && p.finishedAt).map((p) => time(p.finishedAt));
    if (winnerTime <= 0 || !others.length) return false;
    const margin = Math.min(...others) - time(winner.finishedAt);
    return margin >= 0 && margin < winnerTime * PHOTO_FINISH_MARGIN;
  }).length;

/**
 * Wins where someone else reached the checkpoint (75% of the text) before the
 * winner did. The server stamps each racer's crossing from its own replay of
 * their keys, so this can't be claimed by a client. Races from before the
 * stamp was kept, and timed races (no fixed text), can't qualify.
 */
export const countUnderdogWins = (races, userId) =>
  validRaces(races, userId).filter((race) => {
    if (race.mode === 'time' || !isWin(race, userId)) return false;
    const winnerAt = mine(race, userId)?.reached75At;
    if (!winnerAt) return false;
    return race.players.some((p) => String(p.userId) !== userId && p.reached75At && time(p.reached75At) < time(winnerAt));
  }).length;

/** Different players raced against in races the player finished. */
export const countDistinctOpponents = (races, userId) => {
  const opponents = new Set();
  for (const race of validRaces(races, userId)) {
    if (!mine(race, userId)?.finishedAt) continue;
    for (const p of race.players) if (String(p.userId) !== userId) opponents.add(String(p.userId));
  }
  return opponents.size;
};

