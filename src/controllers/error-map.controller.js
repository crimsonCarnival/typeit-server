import { buildDrillText, getErrorMap } from '../services/error-map.service.js';
import { startDrillSession } from '../services/game.service.js';
import { ERROR_MAP_DEFAULT_RUNS, ERROR_MAP_MAX_RUNS } from '../config/error-map.js';

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
      const state = await startDrillSession(req.user._id, buildDrillText(target));
      res.json({ success: true, data: state });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Could not start the drill' });
    }
  },
};

export default errorMapController;
