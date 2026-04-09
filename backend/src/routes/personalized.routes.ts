import { Router, Request, Response } from 'express';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';

const router = Router();

// GET /api/recommendations/personalized
router.get('/', (_req: Request, res: Response): void => {
  try {
    const db = getDatabase();

    // 最近播放 (top 10)
    const recentlyPlayed = db.prepare(`
      SELECT video_id as videoId, title, channel, thumbnail, duration, last_played as lastPlayed, play_count as playCount
      FROM cached_tracks
      WHERE play_count > 0 AND last_played > 0
      ORDER BY last_played DESC
      LIMIT 10
    `).all();

    // 最常播放 (top 10, different from recently played)
    const recentIds = recentlyPlayed.map((t: any) => t.videoId);
    const mostPlayed = db.prepare(`
      SELECT video_id as videoId, title, channel, thumbnail, duration, play_count as playCount
      FROM cached_tracks
      WHERE play_count >= 3
      ORDER BY play_count DESC
      LIMIT 20
    `).all().filter((t: any) => !recentIds.includes(t.videoId)).slice(0, 10);

    // 收藏 (if favorites table exists)
    let favorites: any[] = [];
    try {
      favorites = db.prepare(`
        SELECT video_id as videoId, title, channel, thumbnail, duration
        FROM favorites
        ORDER BY favorited_at DESC
        LIMIT 10
      `).all();
    } catch {
      // favorites table may not exist yet
    }

    res.json({
      recentlyPlayed,
      mostPlayed,
      favorites,
    });
  } catch (err) {
    logger.error('Failed to get personalized recommendations:', err);
    res.status(500).json({ error: 'Failed to get personalized recommendations' });
  }
});

export default router;
