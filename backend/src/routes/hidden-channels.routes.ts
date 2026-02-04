import { Router, Request, Response } from 'express';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';

const router = Router();

/**
 * 隱藏頻道
 * POST /api/hidden-channels
 */
router.post('/', (req: Request, res: Response): void => {
  try {
    const { channelName } = req.body;

    if (!channelName) {
      res.status(400).json({ error: 'channelName is required' });
      return;
    }

    const db = getDatabase();
    const hiddenAt = Date.now();

    db.prepare(
      `INSERT OR REPLACE INTO hidden_channels (channel_name, hidden_at) 
       VALUES (?, ?)`
    ).run(channelName, hiddenAt);

    logger.info(`Hidden channel: ${channelName}`);
    res.json({ success: true, channelName });
  } catch (error) {
    logger.error('Error hiding channel:', error);
    res.status(500).json({ error: 'Failed to hide channel' });
  }
});

/**
 * 取得所有被隱藏的頻道
 * GET /api/hidden-channels
 */
router.get('/', (_req: Request, res: Response): void => {
  try {
    const db = getDatabase();
    const hiddenChannels = db
      .prepare('SELECT channel_name FROM hidden_channels')
      .all() as { channel_name: string }[];

    res.json(hiddenChannels.map(row => row.channel_name));
  } catch (error) {
    logger.error('Error getting hidden channels:', error);
    res.status(500).json({ error: 'Failed to get hidden channels' });
  }
});

/**
 * 取消隱藏頻道
 * DELETE /api/hidden-channels/:channelName
 */
router.delete('/:channelName', (req: Request, res: Response) => {
  try {
    const { channelName } = req.params;

    const db = getDatabase();
    db.prepare('DELETE FROM hidden_channels WHERE channel_name = ?').run(channelName);

    logger.info(`Unhidden channel: ${channelName}`);
    res.json({ success: true, channelName });
  } catch (error) {
    logger.error('Error unhiding channel:', error);
    res.status(500).json({ error: 'Failed to unhide channel' });
  }
});

export default router;
