import { Request, Response } from 'express';
import lyricsService from '../services/lyrics.service';
import logger from '../utils/logger';

export class LyricsController {
  /**
   * GET /api/lyrics/search?q=...
   * 搜尋 LRCLIB 歌詞
   */
  async searchLyrics(req: Request, res: Response): Promise<void> {
    try {
      const { q } = req.query;

      if (!q || typeof q !== 'string') {
        res.status(400).json({
          error: 'Query parameter "q" is required',
        });
        return;
      }

      console.log(`🔍 [Lyrics API] Search: ${q}`);
      const results = await lyricsService.searchLRCLIB(q);

      res.json({
        query: q,
        count: results.length,
        results,
      });
    } catch (error) {
      logger.error('Lyrics search error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to search lyrics',
      });
    }
  }

  /**
   * GET /api/lyrics/lrclib/:lrclibId?videoId=...
   * 透過 LRCLIB ID 獲取特定歌詞
   */
  async getLyricsByLRCLIBId(req: Request, res: Response): Promise<void> {
    try {
      const { lrclibId } = req.params;
      const { videoId } = req.query;

      if (!lrclibId || !videoId || typeof videoId !== 'string') {
        res.status(400).json({
          error: 'lrclibId and videoId are required',
        });
        return;
      }

      console.log(`🎼 [Lyrics API] Get LRCLIB ID: ${lrclibId} for video: ${videoId}`);
      const lyrics = await lyricsService.getLyricsByLRCLIBId(videoId, parseInt(lrclibId, 10));

      if (!lyrics) {
        res.status(404).json({
          error: 'Lyrics not found',
          lrclibId,
        });
        return;
      }

      res.json({
        videoId,
        lyrics,
      });
    } catch (error) {
      logger.error('Lyrics LRCLIB ID error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to fetch lyrics',
      });
    }
  }

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
