import { Request, Response } from 'express';
import recommendationService from '../services/recommendation.service';
import { db } from '../config/database';
import logger from '../utils/logger';
import axios from 'axios';
import { generateDiscoveryQueries } from '../services/gemini.service';
import { getUserProfile } from '../services/style-cache.service';
import youtubeService from '../services/youtube.service';
import { buildTrackIdentity } from '../utils/trackIdentity';

// Mixed recommendations cache (避免每次首頁載入都跑 12s 的 AI + 搜尋)
let mixedCache: { data: any; timestamp: number } | null = null;
const MIXED_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function buildDiscoveryQueriesFallback(listenedArtists: string[], recentTitles: string[]): string[] {
  const artists = listenedArtists.filter(Boolean).slice(0, 3);
  const titles = recentTitles.filter(Boolean).slice(0, 2);
  const queries = [
    artists.length > 0 ? `${artists.join(' ')} similar artists playlist` : '',
    artists.length > 1 ? `${artists[0]} ${artists[1]} related songs` : '',
    titles.length > 0 ? `${titles[0]} songs with similar vibe` : '',
    artists.length > 0 ? `${artists[0]} dream pop indie alternative` : '',
  ];
  return [...new Set(queries.map(query => query.trim()).filter(Boolean))];
}

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

      const result = await recommendationService.getChannelRecommendations(
        pageNum,
        pageSizeNum
      );

      res.json({
        page: pageNum,
        pageSize: pageSizeNum,
        count: result.recommendations.length,
        hasMore: result.hasMore,
        recommendations: result.recommendations,
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

      // 首頁第一頁用 cache（5 分鐘 TTL），避免每次載入都跑 12s
      // 但不要把「空推薦」黏住，否則舊資料回補或新播放歷史進來後首頁仍會長時間維持空白。
      if (
        pageNum === 0
        && mixedCache
        && mixedCache.data?.recommendations?.length > 0
        && (Date.now() - mixedCache.timestamp) < MIXED_CACHE_TTL
      ) {
        res.json(mixedCache.data);
        return;
      }

      // 頻道推薦 + 相似歌曲 + AI 發現：全部並行
      const recentTracks = db.prepare(`
        SELECT video_id as videoId, title, channel_name as channelName
        FROM cached_tracks
        WHERE last_played > 0
        ORDER BY last_played DESC
        LIMIT 5
      `).all() as Array<{ videoId: string; title: string; channelName: string }>;

      const [channelPage, similarResults, discoveryResult] = await Promise.all([
        // 1. 頻道推薦
        recommendationService.getChannelRecommendations(pageNum, pageSizeNum),

        // 2. 相似歌曲（全部並行，個別失敗不影響）
        Promise.allSettled(
          recentTracks.map(track =>
            axios.get(
              `http://localhost:3001/api/recommendations/similar/${track.videoId}`,
              {
                params: {
                  limit: includeNum,
                  title: track.title,
                  artist: track.channelName,
                },
                timeout: 5000,
              }
            ).then((r: any) => r.data?.recommendations || [])
          )
        ),

        // 3. AI 發現推薦（失敗不阻塞，5s 硬超時防止 Gemini hang）
        Promise.race([
          (async () => {
            try {
              const listenedArtists = db.prepare(
                `SELECT DISTINCT channel_name FROM watched_channels ORDER BY watch_count DESC LIMIT 20`
              ).all().map((r: any) => r.channel_name);

              const profile = await getUserProfile();
              const aiQueries = profile ? await generateDiscoveryQueries(profile, listenedArtists) : [];
              const queries = aiQueries.length > 0
                ? aiQueries
                : buildDiscoveryQueriesFallback(listenedArtists, recentTracks.map(track => track.title));
              if (queries.length === 0) return null;

              const listenedSet = new Set(listenedArtists.map((a: string) => a.toLowerCase()));
              const collected = new Map<string, any>();
              const shuffledQueries = [...queries].sort(() => Math.random() - 0.5).slice(0, 2);

              for (const query of shuffledQueries) {
                const results = await youtubeService.search(query, 8);
                for (const result of results) {
                  const channel = (result.channel || '').toLowerCase();
                  if (listenedSet.has(channel)) continue;
                  const identity = `${result.videoId}`;
                  if (!collected.has(identity)) {
                    collected.set(identity, result);
                  }
                  if (collected.size >= 8) break;
                }
                if (collected.size >= 8) break;
              }

              const newResults = Array.from(collected.values()).slice(0, 5);
              return newResults.length > 0 ? newResults : null;
            } catch (err) {
              logger.warn('AI discovery recommendations failed:', err);
              return null;
            }
          })(),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 5000)),
        ]),
      ]);

      // 組合相似歌曲
      const allSimilar: any[] = [];
      for (const result of similarResults) {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          allSimilar.push(...result.value);
        }
      }
      const uniqueSimilarMap = new Map<string, any>();
      for (const track of allSimilar) {
        const identity = buildTrackIdentity(track.title || '', track.channelName || track.channel || '');
        if (!uniqueSimilarMap.has(identity)) {
          uniqueSimilarMap.set(identity, track);
        }
      }
      const uniqueSimilar = Array.from(uniqueSimilarMap.values()).slice(0, 10);
      const channelRecommendations = channelPage.recommendations;

      // 組裝混合推薦
      const mixedRecommendations: any[] = [];

      const styleSections: any[] = [];
      if (uniqueSimilar.length > 0) {
        styleSections.push({
          type: 'similar',
          channelName: '根據您的收聽記錄',
          channelThumbnail: '',
          videos: uniqueSimilar.map((t: any) => ({
            videoId: t.videoId,
            title: t.title,
            thumbnail: t.thumbnail,
            duration: t.duration || 0,
            channel: t.channelName || t.channel || '',
            uploadedAt: t.uploadedAt || '',
          })),
          watchCount: 0,
        });
      }

      if (discoveryResult) {
        styleSections.push({
          type: 'discovery',
          channelName: `🔮 AI 為你發現`,
          channelThumbnail: '',
          videos: discoveryResult.map((r: any) => ({
            videoId: r.videoId,
            title: r.title,
            thumbnail: r.thumbnail,
            duration: r.duration || 0,
            channel: r.channel,
            uploadedAt: r.uploadedAt || '',
          })),
          watchCount: 0,
        });
      }

      if (pageNum === 0 && channelRecommendations.length > 0) {
        mixedRecommendations.push({ type: 'channel', ...channelRecommendations[0] });
        mixedRecommendations.push(...styleSections.slice(0, 2));
        for (const channel of channelRecommendations.slice(1)) {
          mixedRecommendations.push({ type: 'channel', ...channel });
        }
      } else {
        for (const channel of channelRecommendations) {
          mixedRecommendations.push({ type: 'channel', ...channel });
        }
      }

      const responseData = {
        page: pageNum,
        pageSize: pageSizeNum,
        count: mixedRecommendations.length,
        hasMore: channelPage.hasMore,
        recommendations: mixedRecommendations,
      };

      // Cache first page
      if (pageNum === 0) {
        mixedCache = { data: responseData, timestamp: Date.now() };
      }

      res.json(responseData);
    } catch (error) {
      logger.error('Get mixed recommendations error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to get mixed recommendations',
      });
    }
  }

  /**
   * GET /api/recommendations/channel/:channelName?page=0&pageSize=20
   * 獲取單一頻道的影片（分頁）
   */
  async getChannelVideos(req: Request, res: Response): Promise<void> {
    try {
      const { channelName } = req.params;
      const { limit, page, pageSize } = req.query;

      if (!channelName) {
        res.status(400).json({
          error: 'Channel name is required',
        });
        return;
      }

      const pageNum = page ? parseInt(page as string, 10) : 0;
      const pageSizeNum = pageSize
        ? parseInt(pageSize as string, 10)
        : (limit ? parseInt(limit as string, 10) : 20);

      if (!Number.isInteger(pageNum) || !Number.isInteger(pageSizeNum) || pageNum < 0 || pageSizeNum < 1 || pageSizeNum > 30) {
        res.status(400).json({ error: 'Invalid page or pageSize parameter' });
        return;
      }

      const fetchLimit = (pageNum + 1) * pageSizeNum + 1;

      const videos = await recommendationService.getChannelVideos(
        channelName,
        fetchLimit
      );

      const start = pageNum * pageSizeNum;
      const pagedVideos = videos.slice(start, start + pageSizeNum);
      const hasMore = videos.length > start + pageSizeNum;

      res.json({
        channelName,
        page: pageNum,
        pageSize: pageSizeNum,
        count: pagedVideos.length,
        hasMore,
        videos: pagedVideos,
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
      mixedCache = null;

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
