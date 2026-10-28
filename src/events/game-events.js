import { EventEmitter } from 'events';

/**
 * In-process game events. Lets features react to finished runs without
 * game.service importing them (the race manager imports game.service, so a
 * direct import back would be circular).
 *
 * 'run:finished' -> { userId, session, results, resultId, ranked }
 */
export const gameEvents = new EventEmitter();
