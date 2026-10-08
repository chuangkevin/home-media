import { Request, Response } from 'express';
import recommendationService from '../services/recommendation.service';
import { db } from '../config/database';
import logger from '../utils/logger';
import axios from 'axios';
import { generateDiscoveryQueries } from '../services/gemini.service';
import { getUserProfile } from '../services/style-cache.service';
import youtubeService from '../services/youtube.service';
import { buildTrackIdentity } from '../utils/trackIdentity';
import { createRecommendationBudget, recommendationRequestBudget, RecommendationUnavailableError, waitWithinBudget } from '../services/recommendation-budget';

// Mixed recommendations cache (避免每次首頁載入都跑 12s 的 AI + 搜尋)
const mixedCache = new Map<string, { data: any; timestamp: number }>();
const MIXED_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function isValidRecommendationTrack(track: any): boolean {
  return track && /^[a-zA-Z0-9_-]{11}$/.test(track.videoId || '')
    && typeof track.title === 'string' && track.title.trim().length > 0
    && Number.isFinite(track.duration) && track.duration > 0 && track.duration <= 600;
}

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
    const budget = recommendationRequestBudget(req, res);
    try {
      const { page, pageSize } = req.query;

      const pageNum = page ? parseInt(page as string, 10) : 0;
      const pageSizeNum = pageSize ? parseInt(pageSize as string, 10) : 5;

      if (!Number.isInteger(pageNum) || !Number.isInteger(pageSizeNum) || pageNum < 0 || pageSizeNum < 1 || pageSizeNum > 20) {
        res.status(400).json({
          error: 'Invalid page or pageSize parameter',
        });
        return;
      }

      const result = await recommendationService.getChannelRecommendations(
        pageNum,
        pageSizeNum,
        { signal: budget.signal, timeoutMs: budget.remainingMs() }
      );

      if (res.destroyed || res.writableEnded) return;
      res.json({
        page: pageNum,
        pageSize: pageSizeNum,
        count: result.recommendations.length,
        hasMore: result.hasMore,
        recommendations: result.recommendations,
        partial: result.partial || false,
      });
    } catch (error) {
      logger.error('Get channel recommendations error:', error);
      if (!res.destroyed && !res.writableEnded) res.status(error instanceof RecommendationUnavailableError ? 503 : 500).json({
        error: error instanceof Error ? error.message : 'Failed to get recommendations',
      });
    } finally {
      budget.dispose();
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
    const budget = recommendationRequestBudget(req, res);
    try {
      const { page, pageSize, includeCount } = req.query;

      const pageNum = page ? parseInt(page as string, 10) : 0;
      const pageSizeNum = pageSize ? parseInt(pageSize as string, 10) : 5;
      const includeNum = includeCount ? parseInt(includeCount as string, 10) : 3;

      if (!Number.isInteger(pageNum) || !Number.isInteger(pageSizeNum) || !Number.isInteger(includeNum)
        || pageNum < 0 || pageSizeNum < 1 || pageSizeNum > 20 || includeNum < 1 || includeNum > 20) {
        res.status(400).json({ error: 'Invalid page or pageSize parameter' });
        return;
      }

      const cacheKey = `${pageSizeNum}:${includeNum}`;
      const cached = mixedCache.get(cacheKey);
      if (pageNum === 0 && cached && cached.data.recommendations.length > 0
        && Date.now() - cached.timestamp < (cached.data.partial ? 15_000 : MIXED_CACHE_TTL)) {
        res.json(cached.data);
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

      let channelError: unknown;
      let discoveryError: unknown;
      let similarPartial = false;
      const [channelPage, similarResults, discoveryResult] = await Promise.all([
        // 1. 頻道推薦
        recommendationService.getChannelRecommendations(pageNum, pageSizeNum, {
          signal: budget.signal, timeoutMs: budget.remainingMs(),
        }).catch(error => {
          channelError = error;
          return { recommendations: [], hasMore: true, partial: true };
        }),

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
                timeout: Math.min(5000, budget.remainingMs()),
                signal: budget.signal,
              }
            ).then((r: any) => {
              if (r.data?.partial) similarPartial = true;
              return r.data?.recommendations || [];
            })
          )
        ),

        // 3. AI 發現推薦（失敗不阻塞，5s 硬超時防止 Gemini hang）
        (async () => {
            const discoveryBudget = createRecommendationBudget(Math.min(5000, budget.remainingMs()), budget.signal);
            try {
              discoveryBudget.check();
              const listenedArtists = db.prepare(
                `SELECT DISTINCT channel_name FROM watched_channels ORDER BY watch_count DESC LIMIT 20`
              ).all().map((r: any) => r.channel_name);

              const profile = await waitWithinBudget(getUserProfile(), discoveryBudget.signal);
              discoveryBudget.check();
              const aiQueries = profile ? await waitWithinBudget(generateDiscoveryQueries(profile, listenedArtists, {
                signal: discoveryBudget.signal, timeoutMs: discoveryBudget.remainingMs(),
              }), discoveryBudget.signal) : [];
              discoveryBudget.check();
              const queries = aiQueries.length > 0
                ? aiQueries
                : buildDiscoveryQueriesFallback(listenedArtists, recentTracks.map(track => track.title));
              if (queries.length === 0) return null;

              const listenedSet = new Set(listenedArtists.map((a: string) => a.toLowerCase()));
              const collected = new Map<string, any>();
              const shuffledQueries = [...queries].sort(() => Math.random() - 0.5).slice(0, 2);

              for (const query of shuffledQueries) {
                discoveryBudget.check();
                const results = await youtubeService.search(query, 8, {
                  signal: discoveryBudget.signal, timeoutMs: discoveryBudget.remainingMs(),
                });
                discoveryBudget.check();
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
              discoveryError = err;
              logger.warn('AI discovery recommendations failed:', err);
              return null;
            } finally {
              discoveryBudget.dispose();
            }
          })(),
      ]);

      // 組合相似歌曲
      const allSimilar: any[] = [];
      for (const result of similarResults) {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          allSimilar.push(...result.value);
        }
      }
      const uniqueSimilarMap = new Map<string, any>();
      for (const track of allSimilar.filter(isValidRecommendationTrack)) {
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

      const validDiscovery = discoveryResult?.filter(isValidRecommendationTrack) || [];
      if (validDiscovery.length > 0) {
        styleSections.push({
          type: 'discovery',
          channelName: `🔮 AI 為你發現`,
          channelThumbnail: '',
          videos: validDiscovery.map((r: any) => ({
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

      if (pageNum === 0) {
        if (channelRecommendations.length > 0) mixedRecommendations.push({ type: 'channel', ...channelRecommendations[0] });
        mixedRecommendations.push(...styleSections.slice(0, 2));
        for (const channel of channelRecommendations.slice(1)) {
          mixedRecommendations.push({ type: 'channel', ...channel });
        }
      } else {
        for (const channel of channelRecommendations) {
          mixedRecommendations.push({ type: 'channel', ...channel });
        }
      }

      if (mixedRecommendations.length === 0) {
        if (channelError) throw channelError;
        if (discoveryError || similarResults.some(result => result.status === 'rejected')) {
          throw new RecommendationUnavailableError('Recommendation sources are unavailable; please retry');
        }
      }
      if (res.destroyed || res.writableEnded) return;
      const responseData = {
        page: pageNum,
        pageSize: pageSizeNum,
        count: mixedRecommendations.length,
        hasMore: channelPage.hasMore,
        recommendations: mixedRecommendations,
        partial: Boolean(channelPage.partial || channelError || discoveryError || similarPartial
          || similarResults.some(result => result.status === 'rejected')),
      };

      // Cache first page
      if (pageNum === 0 && mixedRecommendations.length > 0) {
        mixedCache.set(cacheKey, { data: responseData, timestamp: Date.now() });
      }

      res.json(responseData);
    } catch (error) {
      logger.error('Get mixed recommendations error:', error);
      if (!res.destroyed && !res.writableEnded) res.status(error instanceof RecommendationUnavailableError ? 503 : 500).json({
        error: error instanceof Error ? error.message : 'Failed to get mixed recommendations',
      });
    } finally {
      budget.dispose();
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
      mixedCache.clear();

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
