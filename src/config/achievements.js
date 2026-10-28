/**
 * Achievement definitions. Names, rarities, categories and thresholds come
 * from the design canvas. Each `metric` names a value computed per player by
 * services/achievement.service.js; a badge unlocks when that value reaches
 * `target`.
 *
 * Which runs count:
 * - Speed and Accuracy badges only consider *ranked* runs (passed the
 *   integrity checks in config/integrity.js), so they can't be forged.
 * - Habits badges count any saved run: they reward playing, not performance.
 * - Racing badges come from finished daily attempts and race wins.
 * - Learning badges come from lesson progress and practice runs.
 */
import { LESSONS } from '../data/lessons.js';

export const ACHIEVEMENT_CATEGORIES = Object.freeze(['speed', 'accuracy', 'habits', 'racing', 'learning']);
export const ACHIEVEMENT_RARITIES = Object.freeze(['common', 'rare', 'epic', 'legendary']);

// Flawless needs a run long enough that 100% means something.
export const FLAWLESS_MIN_CORRECT_CHARS = 100;
// Speedrun: a words test of at least this many words, completed within the time.
export const SPEEDRUN_WORDS = 50;
export const SPEEDRUN_SECONDS = 30;
// Hardcore Hero: a verified hardcore run at this speed.
export const HARDCORE_HERO_WPM = 60;

/**
 * Badges. Tiered badges share a `family`; `tier` counts from 1 and each tier
 * of a family raises the target on the same metric. Ids of the original
 * badges are unchanged so stored unlocks keep their meaning.
 */
export const ACHIEVEMENTS = Object.freeze([
  // Speed
  { id: 'warm-up', family: 'speed', tier: 1, name: 'Warm-up', description: 'Reach 50 WPM', category: 'speed', rarity: 'common', icon: 'bolt', metric: 'bestWpm', target: 50, unit: 'WPM' },
  { id: 'sixty-club', family: 'speed', tier: 2, name: 'Sixty Club', description: 'Reach 60 WPM', category: 'speed', rarity: 'common', icon: 'flame', metric: 'bestWpm', target: 60, unit: 'WPM' },
  { id: 'eighty-up', family: 'speed', tier: 3, name: 'Eighty Up', description: 'Reach 80 WPM', category: 'speed', rarity: 'rare', icon: 'flame', metric: 'bestWpm', target: 80, unit: 'WPM' },
  { id: 'century', family: 'speed', tier: 4, name: 'Century', description: 'Reach 100 WPM', category: 'speed', rarity: 'epic', icon: 'rocket', metric: 'bestWpm', target: 100, unit: 'WPM' },
  { id: 'lightning', family: 'speed', tier: 5, name: 'Lightning', description: 'Reach 130 WPM', category: 'speed', rarity: 'legendary', icon: 'rocket', metric: 'bestWpm', target: 130, unit: 'WPM' },
  { id: 'speedrun', name: 'Speedrun', description: `${SPEEDRUN_WORDS} words in under ${SPEEDRUN_SECONDS}s`, category: 'speed', rarity: 'epic', icon: 'stopwatch', metric: 'speedrunWords', target: SPEEDRUN_WORDS, unit: 'words' },
  { id: 'hardcore-hero', name: 'Hardcore Hero', description: `${HARDCORE_HERO_WPM} WPM on a hardcore run`, category: 'speed', rarity: 'epic', icon: 'skull', metric: 'bestHardcoreWpm', target: HARDCORE_HERO_WPM, unit: 'WPM' },

  // Accuracy
  { id: 'flawless', family: 'flawless', tier: 1, name: 'Flawless', description: 'Finish with 100% accuracy', category: 'accuracy', rarity: 'rare', icon: 'gem', metric: 'flawlessRuns', target: 1, unit: 'runs' },
  { id: 'perfectionist', family: 'flawless', tier: 2, name: 'Perfectionist', description: '10 runs at 100% accuracy', category: 'accuracy', rarity: 'epic', icon: 'gem', metric: 'flawlessRuns', target: 10, unit: 'runs' },
  { id: 'sharpshooter', name: 'Sharpshooter', description: '98%+ accuracy on a 60s test', category: 'accuracy', rarity: 'rare', icon: 'target', metric: 'best60sAccuracy', target: 98, unit: '%' },
  { id: 'steady-hand', name: 'Steady Hand', description: 'Reach 90% consistency', category: 'accuracy', rarity: 'rare', icon: 'pulse', metric: 'bestConsistency', target: 90, unit: '%' },

  // Habits
  { id: 'first-run', family: 'runs', tier: 1, name: 'First Run', description: 'Finish your first test', category: 'habits', rarity: 'common', icon: 'keyboard', metric: 'runs', target: 1, unit: 'runs' },
  { id: 'regular', family: 'runs', tier: 2, name: 'Regular', description: 'Finish 100 tests', category: 'habits', rarity: 'rare', icon: 'keyboard', metric: 'runs', target: 100, unit: 'runs' },
  { id: 'veteran', family: 'runs', tier: 3, name: 'Veteran', description: 'Finish 1,000 tests', category: 'habits', rarity: 'legendary', icon: 'keyboard', metric: 'runs', target: 1000, unit: 'runs' },
  { id: 'week-streak', family: 'streak', tier: 1, name: 'Week Streak', description: 'Play 7 days in a row', category: 'habits', rarity: 'rare', icon: 'calendar', metric: 'longestStreak', target: 7, unit: 'days' },
  { id: 'month-streak', family: 'streak', tier: 2, name: 'Month Streak', description: 'Play 30 days in a row', category: 'habits', rarity: 'epic', icon: 'calendar', metric: 'longestStreak', target: 30, unit: 'days' },
  { id: 'year-streak', family: 'streak', tier: 3, name: 'Unbroken', description: 'Play 100 days in a row', category: 'habits', rarity: 'legendary', icon: 'calendar', metric: 'longestStreak', target: 100, unit: 'days' },
  { id: 'marathon', name: 'Marathon', description: 'Complete a 10 minute test', category: 'habits', rarity: 'common', icon: 'clock', metric: 'longestRunMinutes', target: 10, unit: 'min' },

  // Racing
  { id: 'daily-regular', family: 'daily', tier: 1, name: 'Daily Regular', description: 'Finish 5 daily challenges', category: 'racing', rarity: 'common', icon: 'sun', metric: 'dailiesFinished', target: 5, unit: 'done' },
  { id: 'daily-devotee', family: 'daily', tier: 2, name: 'Daily Devotee', description: 'Finish 30 daily challenges', category: 'racing', rarity: 'rare', icon: 'sun', metric: 'dailiesFinished', target: 30, unit: 'done' },
  { id: 'daily-legend', family: 'daily', tier: 3, name: 'Daily Legend', description: 'Finish 100 daily challenges', category: 'racing', rarity: 'epic', icon: 'sun', metric: 'dailiesFinished', target: 100, unit: 'done' },
  { id: 'race-winner', family: 'race-wins', tier: 1, name: 'Race Winner', description: 'Win a multiplayer race', category: 'racing', rarity: 'rare', icon: 'flag', metric: 'raceWins', target: 1, unit: 'wins' },
  { id: 'race-ace', family: 'race-wins', tier: 2, name: 'Race Ace', description: 'Win 10 multiplayer races', category: 'racing', rarity: 'epic', icon: 'flag', metric: 'raceWins', target: 10, unit: 'wins' },
  { id: 'race-champion', family: 'race-wins', tier: 3, name: 'Champion', description: 'Win 50 multiplayer races', category: 'racing', rarity: 'legendary', icon: 'trophy', metric: 'raceWins', target: 50, unit: 'wins' },

  // Learning
  { id: 'first-lesson', family: 'lessons', tier: 1, name: 'First Lesson', description: 'Pass a lesson', category: 'learning', rarity: 'common', icon: 'book', metric: 'lessonsPassed', target: 1, unit: 'lessons' },
  { id: 'halfway', family: 'lessons', tier: 2, name: 'Halfway There', description: 'Pass 6 lessons', category: 'learning', rarity: 'rare', icon: 'book', metric: 'lessonsPassed', target: 6, unit: 'lessons' },
  { id: 'graduate', family: 'lessons', tier: 3, name: 'Graduate', description: 'Pass every lesson', category: 'learning', rarity: 'epic', icon: 'cap', metric: 'lessonsPassed', target: LESSONS.length, unit: 'lessons' },
  { id: 'common-ground', name: 'Common Ground', description: 'Pass the common-words drill', category: 'learning', rarity: 'common', icon: 'book', metric: 'commonWordsPassed', target: 1, unit: 'passes' },
  { id: 'driller', family: 'drills', tier: 1, name: 'Driller', description: 'Finish 10 key drills', category: 'learning', rarity: 'common', icon: 'drill', metric: 'drillRuns', target: 10, unit: 'drills' },
  { id: 'drill-sergeant', family: 'drills', tier: 2, name: 'Drill Sergeant', description: 'Finish 50 key drills', category: 'learning', rarity: 'rare', icon: 'drill', metric: 'drillRuns', target: 50, unit: 'drills' },
  { id: 'curator', name: 'Curator', description: 'Finish 10 runs on your own word lists', category: 'learning', rarity: 'common', icon: 'list', metric: 'listRuns', target: 10, unit: 'runs' },
]);
