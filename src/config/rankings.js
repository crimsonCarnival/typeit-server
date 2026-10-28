/**
 * Rankings configuration. Boards rank each player's best ranked run (see
 * config/integrity.js) for one (mode, time limit, modifiers) combination.
 */

// Boards are rebuilt at most this often; the UI says "Updated every 5 minutes".
export const RANKINGS_CACHE_TTL_MS = 5 * 60 * 1000;

export const RANKING_PERIODS = Object.freeze(['all', 'month']);
export const RANKING_MODES = Object.freeze(['words', 'phrases']);
export const RANKING_TIME_LIMITS = Object.freeze([30, 60, 90, 120]);
export const RANKING_MODIFIERS = Object.freeze(['none', 'punctuation', 'numbers', 'both']);

export const DEFAULT_RANKINGS_LIMIT = 50;
export const MAX_RANKINGS_LIMIT = 100;

// Regions are derived from the IANA timezone the client already reports
// (e.g. "Europe/Madrid" -> europe), so no extra personal data is collected.
// Players whose zone maps to no region (Etc/*, Atlantic/*, unset) only
// appear on the "all regions" board.
export const REGION_BY_TZ_AREA = Object.freeze({
  Africa: 'africa',
  America: 'americas',
  Asia: 'asia',
  Europe: 'europe',
  Australia: 'oceania',
  Pacific: 'oceania',
});
export const RANKING_REGIONS = Object.freeze(['all', 'africa', 'americas', 'asia', 'europe', 'oceania']);
