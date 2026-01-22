import { Request, Response } from 'express';
import recommendationService from '../services/recommendation.service';
import logger from '../utils/logger';

/**
 * 推薦控制器
 */
export class RecommendationController {
  /**
   * GET /api/recommendations/channels?page=0&pageSize=5
   * 獲取頻道推薦（分頁）
   */
  async getChannelRecommendations(req: Request, res: Response): Promise<void> {
    try {
      const { page, pageSize } = req.query;

      const pageNum = page ? parseInt(page as string, 10) : 0;
      const pageSizeNum = pageSize ? parseInt(pageSize as string, 10) : 5;

      if (pageNum < 0 || pageSizeNum < 1 || pageSizeNum > 20) {
        res.status(400).json({
          error: 'Invalid page or pageSize parameter',
        });
        return;
      }

      const recommendations = await recommendationService.getChannelRecommendations(
        pageNum,
        pageSizeNum
      );

      res.json({
        page: pageNum,
        pageSize: pageSizeNum,
        count: recommendations.length,
        hasMore: recommendations.length === pageSizeNum,
        recommendations,
      });
    } catch (error) {
      logger.error('Get channel recommendations error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get recommendations',
      });
    }
  }

  /**
   * GET /api/recommendations/channel/:channelName?limit=20
   * 獲取單一頻道的影片
   */
  async getChannelVideos(req: Request, res: Response): Promise<void> {
    try {
      const { channelName } = req.params;
      const { limit } = req.query;

      if (!channelName) {
        res.status(400).json({
          error: 'Channel name is required',
        });
        return;
      }

      const limitNum = limit ? parseInt(limit as string, 10) : 20;

      const videos = await recommendationService.getChannelVideos(
        channelName,
        limitNum
      );

      res.json({
        channelName,
        count: videos.length,
        videos,
      });
    } catch (error) {
      logger.error('Get channel videos error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get channel videos',
      });
    }
  }

  /**
   * POST /api/recommendations/refresh
   * 刷新推薦（清除快取）
   */
  async refreshRecommendations(_req: Request, res: Response): Promise<void> {
    try {
      recommendationService.refreshRecommendations();

      res.json({
        success: true,
        message: 'Recommendations cache cleared',
      });
    } catch (error) {
      logger.error('Refresh recommendations error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to refresh recommendations',
      });
    }
  }

  /**
   * GET /api/recommendations/stats
   * 獲取推薦統計資訊
   */
  async getStats(_req: Request, res: Response): Promise<void> {
    try {
      const stats = recommendationService.getStats();

      res.json(stats);
    } catch (error) {
      logger.error('Get recommendation stats error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get stats',
      });
    }
  }
}

export default new RecommendationController();
