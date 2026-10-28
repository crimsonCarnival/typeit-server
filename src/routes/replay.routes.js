import express from 'express';
import { auth, optionalAuth } from '../middleware/auth.middleware.js';
import { requireObjectIdParam } from '../middleware/params.middleware.js';
import { getPbGhost, getReplay } from '../services/replay.service.js';
import { GAME_MODES, TIME_MAX_MAX, TIME_MAX_MIN } from '../utils/validate.js';
import { errorMessage } from '../utils/http.js';

const router = express.Router();
router.param('resultId', requireObjectIdParam('Replay not found'));

/**
 * GET /api/replays/ghost/pb?gameMode=words&timeMax=60
 * The caller's best ranked run for those settings as a ghost timeline.
 */
router.get('/ghost/pb', auth, async (req, res) => {
  try {
    const gameMode = req.query.gameMode;
    const timeMax = Number.parseInt(req.query.timeMax, 10);
    if (!GAME_MODES.includes(gameMode) || !(timeMax >= TIME_MAX_MIN && timeMax <= TIME_MAX_MAX)) {
      return res.status(400).json({ success: false, error: 'Invalid settings' });
    }
    const ghost = await getPbGhost(req.user._id, { gameMode, timeMax });
    res.json({ success: true, data: ghost });
  } catch (error) {
    res.status(500).json({ success: false, error: errorMessage(error) });
  }
});

/**
 * GET /api/replays/:resultId
 * The keystroke log of a run to play back: your own runs, or anyone's ranked run.
 */
router.get('/:resultId', optionalAuth, async (req, res) => {
  try {
    const replay = await getReplay(req.params.resultId, req.user?._id ?? null);
    if (!replay) return res.status(404).json({ success: false, error: 'Replay not found' });
    res.json({ success: true, data: replay });
  } catch (error) {
    res.status(500).json({ success: false, error: errorMessage(error) });
  }
});

export default router;
