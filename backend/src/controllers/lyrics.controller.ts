import { Request, Response } from 'express';
import lyricsService from '../services/lyrics.service';
import logger from '../utils/logger';

export class LyricsController {
  /**
   * GET /api/lyrics/:videoId?title=...&artist=...
   * 獲取歌詞
   */
  async getLyrics(req: Request, res: Response): Promise<void> {
    try {
      const { videoId } = req.params;
      const { title, artist } = req.query;

      console.log(`📝 [Lyrics API] Request: videoId=${videoId}, title=${title}, artist=${artist}`);
      logger.info(`📝 [Lyrics API] Request: videoId=${videoId}, title=${title}`);

      if (!videoId) {
        res.status(400).json({
          error: 'Video ID is required',
        });
        return;
      }

      if (!title || typeof title !== 'string') {
        res.status(400).json({
          error: 'Query parameter "title" is required',
        });
        return;
      }

      console.log(`📝 [Lyrics API] Calling lyrics service...`);
      const lyrics = await lyricsService.getLyrics(
        videoId,
        title,
        artist as string | undefined
      );
      console.log(`📝 [Lyrics API] Service returned:`, lyrics ? 'Found' : 'Not found');

      if (!lyrics) {
        res.status(404).json({
          error: 'Lyrics not found',
          videoId,
        });
        return;
      }

      res.json({
        videoId,
        lyrics,
      });
    } catch (error) {
      logger.error('Lyrics controller error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch lyrics',
      });
    }
  }
}

export default new LyricsController();
