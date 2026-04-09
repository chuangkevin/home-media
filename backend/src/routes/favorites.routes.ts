import { Router, Request, Response } from 'express';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';

const router = Router();

// GET /api/favorites — list all favorites
router.get('/', (_req: Request, res: Response): void => {
  try {
    const db = getDatabase();
    const items = db.prepare('SELECT * FROM favorites ORDER BY favorited_at DESC').all();
    res.json(items);
  } catch (err) {
    logger.error('Failed to fetch favorites:', err);
    res.status(500).json({ error: 'Failed to fetch favorites' });
  }
});

// GET /api/favorites/check/:videoId — check if favorited
router.get('/check/:videoId', (req: Request, res: Response): void => {
  try {
    const db = getDatabase();
    const item = db.prepare('SELECT id FROM favorites WHERE video_id = ?').get(req.params.videoId);
    res.json({ favorited: !!item });
  } catch (err) {
    res.json({ favorited: false });
  }
});

// POST /api/favorites — toggle favorite
router.post('/', (req: Request, res: Response): void => {
  const { videoId, title, channel, thumbnail, duration } = req.body;
  if (!videoId || !title) {
    res.status(400).json({ error: 'videoId and title are required' });
    return;
  }

  try {
    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM favorites WHERE video_id = ?').get(videoId);

    if (existing) {
      // Already favorited — remove (toggle off)
      db.prepare('DELETE FROM favorites WHERE video_id = ?').run(videoId);
      res.json({ favorited: false });
    } else {
      // Not favorited — add (toggle on)
      db.prepare(
        'INSERT INTO favorites (video_id, title, channel, thumbnail, duration, favorited_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(videoId, title, channel || '', thumbnail || '', duration || 0, Date.now());
      res.json({ favorited: true });
    }
  } catch (err) {
    logger.error('Failed to toggle favorite:', err);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

// DELETE /api/favorites/:videoId — remove favorite
router.delete('/:videoId', (req: Request, res: Response): void => {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM favorites WHERE video_id = ?').run(req.params.videoId);
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to remove favorite:', err);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

export default router;
