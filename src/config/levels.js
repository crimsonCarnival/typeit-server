/**
 * Levels and XP. A player's XP only ever grows; their level follows from it.
 *
 * Reaching level L takes `XP_STEP * L * (L + 1)` XP in total, so the gap to
 * the next level grows by XP_STEP * 2 each time: level 1 at 100, 2 at 300,
 * 5 at 1,500, 10 at 5,500, 25 at 32,500, 50 at 127,500.
 */

export const XP_STEP = 50;

// How XP is earned. Every award is made once per event (a saved run, a
// finished race, an unlocked badge), never from a page view.
/** One XP per this many seconds typed in a saved run, up to XP_PER_RUN_MAX. */
export const XP_SECONDS_PER_POINT = 6;
export const XP_PER_RUN_MAX = 50;
export const XP_DAILY_BONUS = 25;
export const XP_RACE_FINISH = 10;
export const XP_RACE_WIN = 25;
export const XP_BY_RARITY = Object.freeze({ common: 25, rare: 50, epic: 100, legendary: 250 });

/** What staff may grant in one go. */
export const XP_GRANT_MAX = 50_000;

/** Total XP needed to reach `level`. */
export const xpForLevel = (level) => XP_STEP * level * (level + 1);

/**
 * Where a player stands for a total of XP: their level, how far into it they
 * are, and what the next level needs.
 */
export const levelInfo = (totalXp) => {
  const xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = Math.floor((Math.sqrt(1 + (4 * xp) / XP_STEP) - 1) / 2);
  // Guard the float edges of the closed form.
  while (xpForLevel(level + 1) <= xp) level++;
  while (level > 0 && xpForLevel(level) > xp) level--;
  const floor = level === 0 ? 0 : xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, xp, into: xp - floor, needed: next - floor, progress: (xp - floor) / (next - floor) };
};

/** XP for a saved run: its typing time, capped. Daily runs earn a bonus. */
export const xpForRun = (elapsedSeconds, { daily = false } = {}) => {
  const seconds = Math.max(0, Number(elapsedSeconds) || 0);
  return Math.min(XP_PER_RUN_MAX, Math.floor(seconds / XP_SECONDS_PER_POINT)) + (daily ? XP_DAILY_BONUS : 0);
};
