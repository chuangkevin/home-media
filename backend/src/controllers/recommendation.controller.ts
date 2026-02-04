import { Request, Response } from 'express';
import recommendationService from '../services/recommendation.service';
import { db } from '../config/database';
import logger from '../utils/logger';
import axios from 'axios';

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
   * GET /api/recommendations/recently-played?limit=10
   * 獲取最近播放的歌曲
   */
  async getRecentlyPlayed(req: Request, res: Response): Promise<void> {
    try {
      const { limit } = req.query;
      const limitNum = limit ? parseInt(limit as string, 10) : 10;

      if (limitNum < 1 || limitNum > 50) {
        res.status(400).json({ error: 'Invalid limit parameter' });
        return;
      }

      const tracks = db.prepare(`
        SELECT 
          video_id as videoId,
          title,
          channel_name as channelName,
          thumbnail,
          duration,
          last_played as lastPlayed,
          play_count as playCount
        FROM cached_tracks
        WHERE last_played > 0
        ORDER BY last_played DESC
        LIMIT ?
      `).all(limitNum) as Array<{
        videoId: string;
        title: string;
        channelName: string;
        thumbnail: string;
        duration: number;
        lastPlayed: number;
        playCount: number;
      }>;

      res.json({
        count: tracks.length,
        tracks,
      });
    } catch (error) {
      logger.error('Get recently played error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get recently played tracks',
      });
    }
  }

  /**
   * GET /api/recommendations/mixed?page=0&pageSize=5&includeCount=3
   * 獲取混合推薦（頻道推薦 + 每個頻道插入相似歌曲）
   */
  async getMixedRecommendations(req: Request, res: Response): Promise<void> {
    try {
      const { page, pageSize, includeCount } = req.query;

      const pageNum = page ? parseInt(page as string, 10) : 0;
      const pageSizeNum = pageSize ? parseInt(pageSize as string, 10) : 5;
      const includeNum = includeCount ? parseInt(includeCount as string, 10) : 3;

      if (pageNum < 0 || pageSizeNum < 1 || pageSizeNum > 20) {
        res.status(400).json({ error: 'Invalid page or pageSize parameter' });
        return;
      }

      // 獲取頻道推薦
      const channelRecommendations = await recommendationService.getChannelRecommendations(
        pageNum,
        pageSizeNum
      );

      // 獲取最近播放的歌曲（用於生成相似推薦）
      const recentTracks = db.prepare(`
        SELECT video_id as videoId
        FROM cached_tracks
        WHERE last_played > 0
        ORDER BY last_played DESC
        LIMIT 5
      `).all() as Array<{ videoId: string }>;

      // 為每個最近播放的歌曲獲取相似推薦
      const similarTracks = new Map<string, any[]>();

      for (const track of recentTracks) {
        try {
          const response = await axios.get(
            `http://localhost:3001/api/recommendations/similar/${track.videoId}`,
            {
              params: { limit: includeNum },
              timeout: 2000,
            }
          );

          if (response.data?.recommendations) {
            similarTracks.set(track.videoId, response.data.recommendations);
          }
        } catch (err) {
          logger.warn(`Failed to fetch similar tracks for ${track.videoId}:`, err);
        }
      }

      // 將相似歌曲混入頻道推薦
      const mixedRecommendations = [];

      for (const channel of channelRecommendations) {
        // 添加原始頻道推薦
        mixedRecommendations.push({
          type: 'channel',
          ...channel,
        });

        // 如果有相似推薦，添加一個"相似推薦"區塊
        if (similarTracks.size > 0 && mixedRecommendations.length <= 2) {
          const allSimilar: any[] = [];
          similarTracks.forEach((tracks) => {
            allSimilar.push(...tracks);
          });

          // 去重並限制數量
          const uniqueSimilar = Array.from(
            new Map(allSimilar.map((t) => [t.videoId, t])).values()
          ).slice(0, 10);

          if (uniqueSimilar.length > 0) {
            mixedRecommendations.push({
              type: 'similar',
              channelName: '根據您的收聽記錄',
              channelThumbnail: '',
              videos: uniqueSimilar.map((t: any) => ({
                videoId: t.videoId,
                title: t.title,
                thumbnail: t.thumbnail,
                duration: t.duration || 0,
              })),
              watchCount: 0,
            });
          }
        }
      }

      res.json({
        page: pageNum,
        pageSize: pageSizeNum,
        count: mixedRecommendations.length,
        hasMore: channelRecommendations.length === pageSizeNum,
        recommendations: mixedRecommendations,
      });
    } catch (error) {
      logger.error('Get mixed recommendations error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get mixed recommendations',
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
