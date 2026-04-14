import { Router, Request, Response } from 'express';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';

const router = Router();

// GET /api/history/playback?limit=50
router.get('/', (req: Request, res: Response): void => {
  const limit = parseInt(req.query.limit as string) || 50;

  try {
    const db = getDatabase();
    const tracks = db.prepare(`
      SELECT video_id as videoId, title, channel_name as channel, thumbnail, duration,
             play_count as playCount, last_played as lastPlayed
      FROM cached_tracks
      WHERE last_played > 0
      ORDER BY last_played DESC
      LIMIT ?
    `).all(limit);

    res.json(tracks);
  } catch (err) {
    logger.error('Failed to fetch playback history:', err);
    res.status(500).json({ error: 'Failed to fetch playback history' });
  }
});

export default router;
