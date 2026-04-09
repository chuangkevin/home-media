import { Router, Request, Response } from 'express';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';

const router = Router();

// GET /api/block — return all blocked items
router.get('/', (_req: Request, res: Response): void => {
  try {
    const db = getDatabase();
    const items = db.prepare('SELECT * FROM blocked_items ORDER BY blocked_at DESC').all();
    res.json(items);
  } catch (err) {
    logger.error('Failed to fetch blocked items:', err);
    res.status(500).json({ error: 'Failed to fetch blocked items' });
  }
});

// POST /api/block — add a blocked item
router.post('/', (req: Request, res: Response): void => {
  const { type, videoId, channelName, title, thumbnail } = req.body;

  if (!type || !['song', 'channel'].includes(type)) {
    res.status(400).json({ error: 'type must be "song" or "channel"' });
    return;
  }
  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  if (type === 'song' && !videoId) {
    res.status(400).json({ error: 'videoId is required for song blocks' });
    return;
  }
  if (type === 'channel' && !channelName) {
    res.status(400).json({ error: 'channelName is required for channel blocks' });
    return;
  }

  try {
    const db = getDatabase();
    // Check for duplicate
    const existing = type === 'song'
      ? db.prepare('SELECT id FROM blocked_items WHERE type = ? AND video_id = ?').get('song', videoId)
      : db.prepare('SELECT id FROM blocked_items WHERE type = ? AND channel_name = ?').get('channel', channelName);

    if (existing) {
      res.json({ success: true, id: (existing as any).id, duplicate: true });
      return;
    }

    const result = db.prepare(
      'INSERT INTO blocked_items (type, video_id, channel_name, title, thumbnail, blocked_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(type, videoId || null, channelName || null, title, thumbnail || null, Date.now());

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    logger.error('Failed to block item:', err);
    res.status(500).json({ error: 'Failed to block item' });
  }
});

// DELETE /api/block/:id — remove a blocked item
router.delete('/:id', (req: Request, res: Response): void => {
  const { id } = req.params;

  try {
    const db = getDatabase();
    db.prepare('DELETE FROM blocked_items WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Failed to unblock item:', err);
    res.status(500).json({ error: 'Failed to unblock item' });
  }
});

export default router;
