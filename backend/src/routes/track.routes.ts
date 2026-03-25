import { Router, Request, Response } from 'express';
import { getDatabase } from '../config/database';
import { analyzeAndCache, getStyle } from '../services/style-cache.service';
import logger from '../utils/logger';

const router = Router();

// POST /api/tracks/:videoId/signal - Record skip/complete event
router.post('/:videoId/signal', (req: Request, res: Response): void => {
  const { videoId } = req.params;
  const { type } = req.body;

  if (!type || !['skip', 'complete'].includes(type)) {
    res.status(400).json({ error: 'type must be "skip" or "complete"' });
    return;
  }

  try {
    const db = getDatabase();
    const column = type === 'skip' ? 'skip_count' : 'complete_count';
    db.prepare(`UPDATE cached_tracks SET ${column} = COALESCE(${column}, 0) + 1 WHERE video_id = ?`).run(videoId);
    res.json({ success: true });
  } catch (err) {
    logger.error(`Failed to record ${type} for ${videoId}:`, err);
    res.status(500).json({ error: 'Failed to record signal' });
  }
});

// POST /api/tracks/:videoId/style - Analyze track style
router.post('/:videoId/style', async (req: Request, res: Response): Promise<void> => {
  const { videoId } = req.params;
  const { title, channel, tags, category } = req.body;

  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }

  try {
    const style = await analyzeAndCache(videoId, title, channel, tags, category);
    if (style) {
      res.json(style);
    } else {
      res.status(404).json({ error: 'Could not analyze style (Gemini not configured or failed)' });
    }
  } catch (err) {
    logger.error(`Failed to analyze style for ${videoId}:`, err);
    res.status(500).json({ error: 'Style analysis failed' });
  }
});

// GET /api/tracks/:videoId/style - Get cached style
router.get('/:videoId/style', (req: Request, res: Response): void => {
  const { videoId } = req.params;
  const style = getStyle(videoId);
  if (style) {
    res.json(style);
  } else {
    res.status(404).json({ error: 'No style data for this track' });
  }
});

export default router;
