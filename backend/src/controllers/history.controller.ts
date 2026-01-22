import { Request, Response } from 'express';
import historyService from '../services/history.service';
import logger from '../utils/logger';

/**
 * 歷史記錄控制器
 */
export class HistoryController {
  /**
   * GET /api/history/searches?limit=50&sortBy=recent
   * 獲取搜尋歷史
   */
  async getSearchHistory(req: Request, res: Response): Promise<void> {
    try {
      const { limit, sortBy } = req.query;

      const limitNum = limit ? parseInt(limit as string, 10) : 50;
      const sortByStr = (sortBy === 'popular' ? 'popular' : 'recent') as 'recent' | 'popular';

      const history = historyService.getSearchHistory(limitNum, sortByStr);

      res.json({
        count: history.length,
        sortBy: sortByStr,
        history,
      });
    } catch (error) {
      logger.error('Get search history error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get search history',
      });
    }
  }

  /**
   * POST /api/history/search
   * 記錄搜尋歷史
   * Body: { query: string, resultCount: number }
   */
  async recordSearch(req: Request, res: Response): Promise<void> {
    try {
      const { query, resultCount } = req.body;

      if (!query || typeof query !== 'string') {
        res.status(400).json({
          error: 'Query is required',
        });
        return;
      }

      const count = resultCount || 0;
      historyService.recordSearch(query, count);

      res.json({
        success: true,
        message: 'Search recorded',
      });
    } catch (error) {
      logger.error('Record search error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to record search',
      });
    }
  }

  /**
   * DELETE /api/history/searches
   * 清除所有搜尋歷史
   */
  async clearSearchHistory(_req: Request, res: Response): Promise<void> {
    try {
      historyService.clearSearchHistory();

      res.json({
        success: true,
        message: 'Search history cleared',
      });
    } catch (error) {
      logger.error('Clear search history error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to clear search history',
      });
    }
  }

  /**
   * GET /api/history/channels?limit=50&sortBy=recent
   * 獲取觀看頻道歷史
   */
  async getWatchedChannels(req: Request, res: Response): Promise<void> {
    try {
      const { limit, sortBy } = req.query;

      const limitNum = limit ? parseInt(limit as string, 10) : 50;
      const sortByStr = (sortBy === 'popular' ? 'popular' : 'recent') as 'recent' | 'popular';

      const channels = historyService.getWatchedChannels(limitNum, sortByStr);

      res.json({
        count: channels.length,
        sortBy: sortByStr,
        channels,
      });
    } catch (error) {
      logger.error('Get watched channels error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get watched channels',
      });
    }
  }

  /**
   * POST /api/history/channel
   * 記錄頻道觀看
   * Body: { channelName: string, channelThumbnail?: string }
   */
  async recordChannelWatch(req: Request, res: Response): Promise<void> {
    try {
      const { channelName, channelThumbnail } = req.body;

      if (!channelName || typeof channelName !== 'string') {
        res.status(400).json({
          error: 'Channel name is required',
        });
        return;
      }

      historyService.recordChannelWatch(channelName, channelThumbnail || '');

      res.json({
        success: true,
        message: 'Channel watch recorded',
      });
    } catch (error) {
      logger.error('Record channel watch error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to record channel watch',
      });
    }
  }

  /**
   * DELETE /api/history/channels
   * 清除所有頻道歷史
   */
  async clearChannelHistory(_req: Request, res: Response): Promise<void> {
    try {
      historyService.clearChannelHistory();

      res.json({
        success: true,
        message: 'Channel history cleared',
      });
    } catch (error) {
      logger.error('Clear channel history error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to clear channel history',
      });
    }
  }

  /**
   * GET /api/history/stats
   * 獲取歷史統計資訊
   */
  async getStats(_req: Request, res: Response): Promise<void> {
    try {
      const stats = historyService.getStats();

      res.json(stats);
    } catch (error) {
      logger.error('Get history stats error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get stats',
      });
    }
  }
}

export default new HistoryController();
