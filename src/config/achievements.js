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
import { GAME_MODES } from '../utils/validate.js';

export const ACHIEVEMENT_CATEGORIES = Object.freeze(['speed', 'accuracy', 'habits', 'racing', 'learning']);
export const ACHIEVEMENT_RARITIES = Object.freeze(['common', 'rare', 'epic', 'legendary']);

// Flawless needs a run long enough that 100% means something.
export const FLAWLESS_MIN_CORRECT_CHARS = 100;
// Speedrun: a words test of at least this many words, completed within the time.
export const SPEEDRUN_WORDS = 50;
export const SPEEDRUN_SECONDS = 30;
// Hardcore Hero: a verified hardcore run at this speed.
export const HARDCORE_HERO_WPM = 60;

// Eligibility for the history-based badges. A run counts when it is verified
// (ranked) and a normal test: practice and daily runs have their own text and
// rules, so they never mix into personal bests or sequences.
export const MIN_BADGE_ACCURACY = 95;
// Breakthrough: a new personal best at least this much above the previous one.
export const BREAKTHROUGH_GAIN = 0.1;
// Metronome: this many 60s tests in a row, fastest and slowest within this band of their mean.
export const METRONOME_RUNS = 5;
export const METRONOME_BAND = 0.05;
export const METRONOME_SECONDS = 60;
// Triple Threat: perfect runs in a row (each long enough that 100% means something).
export const TRIPLE_THREAT_RUNS = 3;
// Perfect Storm: same run, same time limit.
export const PERFECT_STORM_WPM = 100;
export const PERFECT_STORM_SECONDS = 60;
// The Comeback: the beaten personal best had stood this long.
export const COMEBACK_PB_DAYS = 30;
// Unstoppable Momentum: personal bests in a row, each in a different configuration.
export const MOMENTUM_RUNS = 3;
// Well-Traveled
export const WELL_TRAVELED_RUNS = 10;
export const WELL_TRAVELED_CONFIGS = 3;
// Comeback Kid: days with no test, then this many tests after returning.
export const COMEBACK_KID_GAP_DAYS = 14;
export const COMEBACK_KID_RUNS = 3;
// Qualifying test for Full Spectrum and Polymath: finished, at least this accurate.
export const QUALIFYING_ACCURACY = 90;
// Racing
export const PHOTO_FINISH_MARGIN = 0.02;
export const UNDERDOG_CHECKPOINT = 0.75;
export const SOCIAL_BUTTERFLY_OPPONENTS = 10;
// Key mastery: samples a key needs before and after its drill, and how much
// its error rate must fall.
export const KEY_MIN_PRESSES = 30;
export const KEY_ERROR_DROP = 0.2;
export const POLYMATH_LANGUAGES = 3;
// Only this many of a player's latest runs / races feed the sequence badges.
export const HISTORY_RUN_LIMIT = 3000;
export const HISTORY_RACE_LIMIT = 1000;

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
  { id: 'supersonic', family: 'speed', tier: 5, name: 'Supersonic', description: 'Reach 120 WPM', category: 'speed', rarity: 'legendary', icon: 'rocket', metric: 'bestWpm', target: 120, unit: 'WPM' },
  { id: 'lightning', family: 'speed', tier: 6, name: 'Lightning', description: 'Reach 130 WPM', category: 'speed', rarity: 'legendary', icon: 'rocket', metric: 'bestWpm', target: 130, unit: 'WPM' },
  { id: 'speedrun', name: 'Speedrun', description: `${SPEEDRUN_WORDS} words in under ${SPEEDRUN_SECONDS}s`, category: 'speed', rarity: 'epic', icon: 'stopwatch', metric: 'speedrunWords', target: SPEEDRUN_WORDS, unit: 'words' },
  { id: 'hardcore-hero', name: 'Hardcore Hero', description: `${HARDCORE_HERO_WPM} WPM on a hardcore run`, category: 'speed', rarity: 'epic', icon: 'skull', metric: 'bestHardcoreWpm', target: HARDCORE_HERO_WPM, unit: 'WPM' },
  { id: 'breakthrough', name: 'Breakthrough', description: `Beat your personal best by ${BREAKTHROUGH_GAIN * 100}% with ${MIN_BADGE_ACCURACY}%+ accuracy, in the same kind of test`, category: 'speed', rarity: 'rare', icon: 'bolt', metric: 'breakthroughs', target: 1, unit: 'runs' },

  // Hidden: name and criteria stay secret until unlocked (see maskHidden in the achievement service).
  { id: 'perfect-storm', hidden: true, hint: 'Speed and precision in one run.', name: 'Perfect Storm', description: `${PERFECT_STORM_WPM} WPM with 100% accuracy in one verified ${PERFECT_STORM_SECONDS}s test`, category: 'speed', rarity: 'legendary', icon: 'flame', metric: 'perfectStorms', target: 1, unit: 'runs' },
  { id: 'against-the-clock', hidden: true, hint: 'Some records are won at the last second.', name: 'Against the Clock', description: 'Set a personal best and finish with less than a second left on the clock', category: 'speed', rarity: 'epic', icon: 'stopwatch', metric: 'clockFinishes', target: 1, unit: 'runs' },
  { id: 'the-comeback', hidden: true, hint: 'Old records can fall.', name: 'The Comeback', description: `Beat a personal best that had stood for ${COMEBACK_PB_DAYS}+ days`, category: 'speed', rarity: 'epic', icon: 'trophy', metric: 'oldRecordsBroken', target: 1, unit: 'records' },
  { id: 'unstoppable-momentum', hidden: true, hint: 'Keep improving.', name: 'Unstoppable Momentum', description: `Set a personal best ${MOMENTUM_RUNS} runs in a row, each in a different kind of test`, category: 'speed', rarity: 'rare', icon: 'rocket', metric: 'momentumChain', target: MOMENTUM_RUNS, unit: 'in a row' },

  // Accuracy
  { id: 'flawless', family: 'flawless', tier: 1, name: 'Flawless', description: 'Finish with 100% accuracy', category: 'accuracy', rarity: 'rare', icon: 'gem', metric: 'flawlessRuns', target: 1, unit: 'runs' },
  { id: 'perfectionist', family: 'flawless', tier: 2, name: 'Perfectionist', description: '10 runs at 100% accuracy', category: 'accuracy', rarity: 'epic', icon: 'gem', metric: 'flawlessRuns', target: 10, unit: 'runs' },
  { id: 'sharpshooter', name: 'Sharpshooter', description: '98%+ accuracy on a 60s test', category: 'accuracy', rarity: 'rare', icon: 'target', metric: 'best60sAccuracy', target: 98, unit: '%' },
  { id: 'metronome', name: 'Metronome', description: `${METRONOME_RUNS} verified ${METRONOME_SECONDS}s tests in a row at ${MIN_BADGE_ACCURACY}%+ accuracy, all within ${METRONOME_BAND * 100}% of the same speed`, category: 'accuracy', rarity: 'epic', icon: 'pulse', metric: 'metronomeRuns', target: METRONOME_RUNS, unit: 'in a row' },
  { id: 'triple-threat', name: 'Triple Threat', description: `${TRIPLE_THREAT_RUNS} verified runs in a row at 100% accuracy (${FLAWLESS_MIN_CORRECT_CHARS}+ characters each)`, category: 'accuracy', rarity: 'epic', icon: 'gem', metric: 'perfectStreak', target: TRIPLE_THREAT_RUNS, unit: 'in a row' },
  { id: 'number-cruncher', name: 'Number Cruncher', description: `Finish a verified test with numbers on and ${MIN_BADGE_ACCURACY}%+ accuracy`, category: 'accuracy', rarity: 'rare', icon: 'keyboard', metric: 'numbersRuns', target: 1, unit: 'runs' },
  { id: 'punctuation-pro', name: 'Punctuation Pro', description: `Finish a verified test with punctuation on and ${MIN_BADGE_ACCURACY}%+ accuracy`, category: 'accuracy', rarity: 'rare', icon: 'keyboard', metric: 'punctuationRuns', target: 1, unit: 'runs' },
  { id: 'modifier-master', name: 'Modifier Master', description: `Finish a verified test with numbers and punctuation on and ${MIN_BADGE_ACCURACY}%+ accuracy`, category: 'accuracy', rarity: 'epic', icon: 'gem', metric: 'bothModifierRuns', target: 1, unit: 'runs' },
  { id: 'steady-hand', name: 'Steady Hand', description: 'Reach 90% consistency', category: 'accuracy', rarity: 'rare', icon: 'pulse', metric: 'bestConsistency', target: 90, unit: '%' },

  // Habits
  { id: 'first-run', family: 'runs', tier: 1, name: 'First Run', description: 'Finish your first test', category: 'habits', rarity: 'common', icon: 'keyboard', metric: 'runs', target: 1, unit: 'runs' },
  { id: 'regular', family: 'runs', tier: 2, name: 'Regular', description: 'Finish 100 tests', category: 'habits', rarity: 'rare', icon: 'keyboard', metric: 'runs', target: 100, unit: 'runs' },
  { id: 'veteran', family: 'runs', tier: 3, name: 'Veteran', description: 'Finish 1,000 tests', category: 'habits', rarity: 'legendary', icon: 'keyboard', metric: 'runs', target: 1000, unit: 'runs' },
  { id: 'week-streak', family: 'streak', tier: 1, name: 'Week Streak', description: 'Play 7 days in a row', category: 'habits', rarity: 'rare', icon: 'calendar', metric: 'longestStreak', target: 7, unit: 'days' },
  { id: 'month-streak', family: 'streak', tier: 2, name: 'Month Streak', description: 'Play 30 days in a row', category: 'habits', rarity: 'epic', icon: 'calendar', metric: 'longestStreak', target: 30, unit: 'days' },
  { id: 'year-streak', family: 'streak', tier: 3, name: 'Unbroken', description: 'Play 100 days in a row', category: 'habits', rarity: 'legendary', icon: 'calendar', metric: 'longestStreak', target: 100, unit: 'days' },
  { id: 'well-traveled', name: 'Well-Traveled', description: `Finish ${WELL_TRAVELED_RUNS} verified tests across ${WELL_TRAVELED_CONFIGS} different kinds of test`, category: 'habits', rarity: 'common', icon: 'flag', metric: 'wellTraveled', target: WELL_TRAVELED_RUNS, unit: 'tests' },
  { id: 'full-spectrum', name: 'Full Spectrum', description: `Finish a test in every mode: ${GAME_MODES.join(', ')}`, category: 'habits', rarity: 'rare', icon: 'target', metric: 'modesPlayed', target: GAME_MODES.length, unit: 'modes' },
  { id: 'polymath', name: 'Polymath', description: `Finish words tests in ${POLYMATH_LANGUAGES} different languages`, category: 'habits', rarity: 'epic', icon: 'cap', metric: 'languagesPlayed', target: POLYMATH_LANGUAGES, unit: 'languages' },
  { id: 'comeback-kid', name: 'Comeback Kid', description: `Return after ${COMEBACK_KID_GAP_DAYS}+ days away and finish ${COMEBACK_KID_RUNS} tests`, category: 'habits', rarity: 'rare', icon: 'calendar', metric: 'comebackRuns', target: COMEBACK_KID_RUNS, unit: 'tests' },
  { id: 'long-haul', family: 'long-haul', tier: 1, name: 'Long Haul', description: 'Type for 1 hour in total', category: 'habits', rarity: 'common', icon: 'clock', metric: 'activeHours', target: 1, unit: 'h' },
  { id: 'veteran-typist', family: 'long-haul', tier: 2, name: 'Veteran Typist', description: 'Type for 5 hours in total', category: 'habits', rarity: 'rare', icon: 'clock', metric: 'activeHours', target: 5, unit: 'h' },
  { id: 'deep-practice', family: 'long-haul', tier: 3, name: 'Deep Practice', description: 'Type for 10 hours in total', category: 'habits', rarity: 'epic', icon: 'clock', metric: 'activeHours', target: 10, unit: 'h' },
  { id: 'keyboard-devotee', family: 'long-haul', tier: 4, name: 'Keyboard Devotee', description: 'Type for 25 hours in total', category: 'habits', rarity: 'epic', icon: 'clock', metric: 'activeHours', target: 25, unit: 'h' },
  { id: 'lifetime-typist', family: 'long-haul', tier: 5, name: 'Lifetime Typist', description: 'Type for 100 hours in total', category: 'habits', rarity: 'legendary', icon: 'clock', metric: 'activeHours', target: 100, unit: 'h' },
  { id: 'marathon', name: 'Marathon', description: 'Complete a 10 minute test', category: 'habits', rarity: 'common', icon: 'clock', metric: 'longestRunMinutes', target: 10, unit: 'min' },

  // Racing
  { id: 'daily-regular', family: 'daily', tier: 1, name: 'Daily Regular', description: 'Finish 5 daily challenges', category: 'racing', rarity: 'common', icon: 'sun', metric: 'dailiesFinished', target: 5, unit: 'done' },
  { id: 'daily-devotee', family: 'daily', tier: 2, name: 'Daily Devotee', description: 'Finish 30 daily challenges', category: 'racing', rarity: 'rare', icon: 'sun', metric: 'dailiesFinished', target: 30, unit: 'done' },
  { id: 'daily-legend', family: 'daily', tier: 3, name: 'Daily Legend', description: 'Finish 100 daily challenges', category: 'racing', rarity: 'epic', icon: 'sun', metric: 'dailiesFinished', target: 100, unit: 'done' },
  { id: 'race-winner', family: 'race-wins', tier: 1, name: 'Race Winner', description: 'Win a multiplayer race', category: 'racing', rarity: 'rare', icon: 'flag', metric: 'raceWins', target: 1, unit: 'wins' },
  { id: 'race-ace', family: 'race-wins', tier: 2, name: 'Race Ace', description: 'Win 10 multiplayer races', category: 'racing', rarity: 'epic', icon: 'flag', metric: 'raceWins', target: 10, unit: 'wins' },
  { id: 'race-champion', family: 'race-wins', tier: 3, name: 'Champion', description: 'Win 50 multiplayer races', category: 'racing', rarity: 'legendary', icon: 'trophy', metric: 'raceWins', target: 50, unit: 'wins' },
  { id: 'win-streak', family: 'win-streak', tier: 1, name: 'Win Streak', description: 'Win 3 multiplayer races in a row', category: 'racing', rarity: 'rare', icon: 'flag', metric: 'winStreak', target: 3, unit: 'in a row' },
  { id: 'race-unstoppable', family: 'win-streak', tier: 2, name: 'Unstoppable', description: 'Win 10 multiplayer races in a row', category: 'racing', rarity: 'epic', icon: 'trophy', metric: 'winStreak', target: 10, unit: 'in a row' },
  { id: 'photo-finish', name: 'Photo Finish', description: `Win a race by less than ${PHOTO_FINISH_MARGIN * 100}% of your finishing time`, category: 'racing', rarity: 'epic', icon: 'stopwatch', metric: 'photoFinishes', target: 1, unit: 'wins' },
  { id: 'underdog', name: 'Underdog', description: `Win a race after trailing at the ${UNDERDOG_CHECKPOINT * 100}% mark`, category: 'racing', rarity: 'legendary', icon: 'flame', metric: 'underdogWins', target: 1, unit: 'wins' },
  { id: 'social-butterfly', name: 'Social Butterfly', description: `Finish races against ${SOCIAL_BUTTERFLY_OPPONENTS} different players`, category: 'racing', rarity: 'rare', icon: 'sun', metric: 'distinctOpponents', target: SOCIAL_BUTTERFLY_OPPONENTS, unit: 'players' },

  // Learning
  { id: 'first-lesson', family: 'lessons', tier: 1, name: 'First Lesson', description: 'Pass a lesson', category: 'learning', rarity: 'common', icon: 'book', metric: 'lessonsPassed', target: 1, unit: 'lessons' },
  { id: 'halfway', family: 'lessons', tier: 2, name: 'Halfway There', description: 'Pass 6 lessons', category: 'learning', rarity: 'rare', icon: 'book', metric: 'lessonsPassed', target: 6, unit: 'lessons' },
  { id: 'graduate', family: 'lessons', tier: 3, name: 'Graduate', description: 'Pass every lesson', category: 'learning', rarity: 'epic', icon: 'cap', metric: 'lessonsPassed', target: LESSONS.length, unit: 'lessons' },
  { id: 'common-ground', name: 'Common Ground', description: 'Pass the common-words drill', category: 'learning', rarity: 'common', icon: 'book', metric: 'commonWordsPassed', target: 1, unit: 'passes' },
  { id: 'driller', family: 'drills', tier: 1, name: 'Driller', description: 'Finish 10 key drills', category: 'learning', rarity: 'common', icon: 'drill', metric: 'drillRuns', target: 10, unit: 'drills' },
  { id: 'drill-sergeant', family: 'drills', tier: 2, name: 'Drill Sergeant', description: 'Finish 50 key drills', category: 'learning', rarity: 'rare', icon: 'drill', metric: 'drillRuns', target: 50, unit: 'drills' },
  { id: 'weakest-link', family: 'key-mastery', tier: 1, name: 'Weakest Link', description: `Drill one of your weakest keys until its mistakes drop ${KEY_ERROR_DROP * 100}%`, category: 'learning', rarity: 'rare', icon: 'drill', metric: 'improvedKeys', target: 1, unit: 'keys' },
  { id: 'problem-solver', family: 'key-mastery', tier: 2, name: 'Problem Solver', description: 'Do the same for 3 different weak keys', category: 'learning', rarity: 'epic', icon: 'book', metric: 'improvedKeys', target: 3, unit: 'keys' },
  { id: 'curator', name: 'Curator', description: 'Finish 10 runs on your own word lists', category: 'learning', rarity: 'common', icon: 'list', metric: 'listRuns', target: 10, unit: 'runs' },
]);
