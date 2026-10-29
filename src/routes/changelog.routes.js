import express from 'express';
import { getChangelog } from '../services/changelog.service.js';

const router = express.Router();

/** GET /api/changelog — the compiled release notes (public). */
router.get('/', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ success: true, data: await getChangelog() });
  } catch {
    res.status(500).json({ success: false, error: 'Could not load the release notes' });
  }
});

export default router;
