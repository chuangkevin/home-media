import { Request, Response } from 'express';
import youtubeService from '../services/youtube.service';
import logger from '../utils/logger';

export class YouTubeController {
  /**
   * GET /api/search?q=query&limit=20
   * 搜尋 YouTube 影片
   */
  async search(req: Request, res: Response): Promise<void> {
    try {
      const { q, limit } = req.query;

      if (!q || typeof q !== 'string') {
        res.status(400).json({
          error: 'Query parameter "q" is required',
        });
        return;
      }

      const limitNum = limit ? parseInt(limit as string, 10) : 20;
      const results = await youtubeService.search(q, limitNum);

      res.json({
        query: q,
        count: results.length,
        results,
      });
    } catch (error) {
      logger.error('Search controller error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to search',
      });
    }
  }

  /**
   * GET /api/video/:videoId
   * 獲取影片資訊
   */
  async getVideoInfo(req: Request, res: Response): Promise<void> {
    try {
      const { videoId } = req.params;

      if (!videoId) {
        res.status(400).json({
          error: 'Video ID is required',
        });
        return;
      }

      const isValid = await youtubeService.validateVideoId(videoId);
      if (!isValid) {
        res.status(400).json({
          error: 'Invalid video ID',
        });
        return;
      }

      const info = await youtubeService.getVideoInfo(videoId);
      res.json(info);
    } catch (error) {
      logger.error('Get video info error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get video info',
      });
    }
  }

  /**
   * GET /api/stream/:videoId
   * 串流音訊 - 使用 yt-dlp（更穩定）
   */
  async streamAudio(req: Request, res: Response): Promise<void> {
    try {
      const { videoId } = req.params;

      if (!videoId) {
        res.status(400).json({
          error: 'Video ID is required',
        });
        return;
      }

      const isValid = await youtubeService.validateVideoId(videoId);
      if (!isValid) {
        res.status(400).json({
          error: 'Invalid video ID',
        });
        return;
      }

      logger.info(`Streaming audio for video: ${videoId} via yt-dlp`);

      // 使用 yt-dlp 獲取音訊 URL
      const audioUrl = await youtubeService.getAudioStreamUrl(videoId);

      // 重定向到 YouTube 的音訊 URL
      logger.info(`Redirecting to audio URL for ${videoId}`);
      res.redirect(audioUrl);
    } catch (error) {
      logger.error('Stream controller error:', error);
      if (!res.headersSent) {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Failed to stream audio',
        });
      }
    }
  }
}

export default new YouTubeController();
