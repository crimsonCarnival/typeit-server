import {
  QUICK_MATCH_MAX_PLAYERS,
  QUICK_MATCH_RATING_SPREAD,
  QUICK_MATCH_WAIT_MS,
  QUICK_MATCH_WIDEN_AFTER_MS,
} from '../../config/race.js';

/**
 * Groups queued players into quick matches. Pure.
 *
 * Players are taken in rating order; a group holds players within
 * QUICK_MATCH_RATING_SPREAD of its lowest rating (any spread once its
 * longest-waiting player has waited QUICK_MATCH_WIDEN_AFTER_MS). A group
 * starts when it is full, or when it has two or more players and its
 * longest-waiting player has waited QUICK_MATCH_WAIT_MS.
 *
 * @param {Array<{userId:string, rating:number, at:number}>} queue
 * @returns {string[][]} groups of userIds to put in a room together
 */
export const formMatches = (queue, now) => {
  const sorted = [...queue].sort((a, b) => a.rating - b.rating || a.at - b.at);
  const groups = [];
  let current = [];
  const flush = () => {
    const oldest = Math.min(...current.map((e) => e.at));
    if (current.length >= QUICK_MATCH_MAX_PLAYERS || (current.length >= 2 && now - oldest >= QUICK_MATCH_WAIT_MS)) {
      groups.push(current.map((e) => e.userId));
    }
    current = [];
  };
  for (const entry of sorted) {
    if (current.length) {
      const oldest = Math.min(...current.map((e) => e.at), entry.at);
      const widened = now - oldest >= QUICK_MATCH_WIDEN_AFTER_MS;
      const tooFar = entry.rating - current[0].rating > QUICK_MATCH_RATING_SPREAD && !widened;
      if (tooFar || current.length >= QUICK_MATCH_MAX_PLAYERS) flush();
    }
    current.push(entry);
  }
  if (current.length) flush();
  return groups;
};
