import { buildDrillText, buildWeakKeysText, getErrorMap, getErrorTrends, weakTargets } from '../services/error-map.service.js';
import { startPracticeSession } from '../services/game.service.js';
import { ERROR_MAP_DEFAULT_RUNS, ERROR_MAP_MAX_RUNS, TRENDS_DEFAULT_WEEKS, TRENDS_MAX_WEEKS } from '../config/error-map.js';

// A drill target is one key or a two-character digraph from the keys the
// error map can report on.
const DRILL_TARGET = /^[a-z0-9 .,!?;:'"-]{1,2}$/i;

const errorMapController = {
  /**
   * GET /api/error-map?runs=N
   * Per-key errors, typed-instead distribution and weakest digraphs over the
   * caller's last N runs.
   */
  get: async (req, res) => {
    const runs = Number(req.query.runs ?? ERROR_MAP_DEFAULT_RUNS);
    if (!Number.isInteger(runs) || runs < 1 || runs > ERROR_MAP_MAX_RUNS) {
      return res.status(400).json({ success: false, error: `runs must be 1-${ERROR_MAP_MAX_RUNS}` });
    }
    try {
      const data = await getErrorMap(req.user._id, runs);
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Could not load the error map' });
    }
  },

  /**
   * POST /api/game/drill { target }
   * Loads a practice text focused on one key or digraph into the session.
   */
  drill: async (req, res) => {
    const { target } = req.body || {};
    if (typeof target !== 'string' || !DRILL_TARGET.test(target)) {
      return res.status(400).json({ success: false, error: 'Invalid drill target' });
    }
    try {
      const state = await startPracticeSession(req.user._id, buildDrillText(target), { kind: 'drill', id: target });
      res.json({ success: true, data: state });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Could not start the drill' });
    }
  },

  /**
   * GET /api/error-map/trends?weeks=N
   * Weekly error rate, average WPM and the weakest keys' error rates.
   */
  trends: async (req, res) => {
    const weeks = Number(req.query.weeks ?? TRENDS_DEFAULT_WEEKS);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > TRENDS_MAX_WEEKS) {
      return res.status(400).json({ success: false, error: `weeks must be 1-${TRENDS_MAX_WEEKS}` });
    }
    try {
      res.json({ success: true, data: await getErrorTrends(req.user._id, weeks) });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Could not load trends' });
    }
  },

  /**
   * POST /api/game/weak-keys
   * Practice run weighted toward the caller's weakest keys and digraphs
   * (from their recent runs). Saved, never ranked.
   */
  weakKeys: async (req, res) => {
    try {
      const targets = weakTargets(await getErrorMap(req.user._id, ERROR_MAP_DEFAULT_RUNS));
      if (!targets.keys.length && !targets.digraphs.length) {
        return res.status(409).json({ success: false, error: 'Play a few more runs first: no weak keys yet.' });
      }
      const state = await startPracticeSession(req.user._id, buildWeakKeysText(targets), {
        kind: 'weak-keys',
        id: [...targets.keys, ...targets.digraphs].join(' '),
      });
      res.json({ success: true, data: { ...state, targets } });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Could not start the practice run' });
    }
  },
};

export default errorMapController;
