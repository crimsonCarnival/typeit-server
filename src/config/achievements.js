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
 */
export const ACHIEVEMENT_CATEGORIES = Object.freeze(['speed', 'accuracy', 'habits', 'racing']);
export const ACHIEVEMENT_RARITIES = Object.freeze(['common', 'rare', 'epic']);

// Flawless needs a run long enough that 100% means something.
export const FLAWLESS_MIN_CORRECT_CHARS = 100;
// Speedrun: a words test of at least this many words, completed within the time.
export const SPEEDRUN_WORDS = 50;
export const SPEEDRUN_SECONDS = 30;

export const ACHIEVEMENTS = Object.freeze([
  { id: 'first-run', name: 'First Run', description: 'Finish your first test', category: 'habits', rarity: 'common', icon: 'keyboard', metric: 'runs', target: 1, unit: 'runs' },
  { id: 'warm-up', name: 'Warm-up', description: 'Reach 50 WPM', category: 'speed', rarity: 'common', icon: 'bolt', metric: 'bestWpm', target: 50, unit: 'WPM' },
  { id: 'sixty-club', name: 'Sixty Club', description: 'Reach 60 WPM', category: 'speed', rarity: 'common', icon: 'flame', metric: 'bestWpm', target: 60, unit: 'WPM' },
  { id: 'century', name: 'Century', description: 'Reach 100 WPM', category: 'speed', rarity: 'epic', icon: 'rocket', metric: 'bestWpm', target: 100, unit: 'WPM' },
  { id: 'flawless', name: 'Flawless', description: 'Finish with 100% accuracy', category: 'accuracy', rarity: 'rare', icon: 'gem', metric: 'bestAccuracy', target: 100, unit: '%' },
  { id: 'sharpshooter', name: 'Sharpshooter', description: '98%+ accuracy on a 60s test', category: 'accuracy', rarity: 'rare', icon: 'target', metric: 'best60sAccuracy', target: 98, unit: '%' },
  { id: 'steady-hand', name: 'Steady Hand', description: 'Reach 90% consistency', category: 'accuracy', rarity: 'rare', icon: 'pulse', metric: 'bestConsistency', target: 90, unit: '%' },
  { id: 'week-streak', name: 'Week Streak', description: 'Play 7 days in a row', category: 'habits', rarity: 'rare', icon: 'calendar', metric: 'longestStreak', target: 7, unit: 'days' },
  { id: 'marathon', name: 'Marathon', description: 'Complete a 10 minute test', category: 'habits', rarity: 'common', icon: 'clock', metric: 'longestRunMinutes', target: 10, unit: 'min' },
  { id: 'speedrun', name: 'Speedrun', description: `${SPEEDRUN_WORDS} words in under ${SPEEDRUN_SECONDS}s`, category: 'speed', rarity: 'epic', icon: 'stopwatch', metric: 'speedrunWords', target: SPEEDRUN_WORDS, unit: 'words' },
  { id: 'daily-regular', name: 'Daily Regular', description: 'Finish 5 daily challenges', category: 'racing', rarity: 'common', icon: 'sun', metric: 'dailiesFinished', target: 5, unit: 'done' },
  { id: 'race-winner', name: 'Race Winner', description: 'Win a multiplayer race', category: 'racing', rarity: 'rare', icon: 'flag', metric: 'raceWins', target: 1, unit: 'wins' },
]);
