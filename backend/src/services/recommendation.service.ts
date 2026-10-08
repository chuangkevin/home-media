import { db } from '../config/database';
import { ChannelRecommendation } from '../types/history.types';
import { YouTubeSearchResult } from '../types/youtube.types';
import historyService from './history.service';
import youtubeService from './youtube.service';
import logger from '../utils/logger';

import {
  createRecommendationBudget, recommendationFetchLimit, RecommendationOptions,
  RecommendationUnavailableError, RECOMMENDATION_BUDGET_MS, waitWithinBudget,
} from './recommendation-budget';

const channelFetchLimit = recommendationFetchLimit;

interface ChannelRecommendationPage {
  recommendations: ChannelRecommendation[];
  hasMore: boolean;
  partial?: boolean;
}

/**
 * 推薦服務
 * 負責生成基於觀看歷史的推薦內容
 */
class RecommendationService {
  private readonly VIDEOS_PER_CHANNEL = 20; // 每個頻道推薦 20 首影片（橫向滾動 lazy load）

  constructor(
    private readonly channelFetchTimeoutMs = 10_000,
    private readonly requestTimeoutMs = RECOMMENDATION_BUDGET_MS
  ) {}

  private normalizeChannelVideos(videos: YouTubeSearchResult[]): YouTubeSearchResult[] {
    if (!Array.isArray(videos)) return [];
    return videos
      .filter(v => v && /^[a-zA-Z0-9_-]{11}$/.test(v.videoId) && typeof v.title === 'string'
        && v.title.trim().length > 0 && Number.isFinite(v.duration) && v.duration > 0 && v.duration <= 600)
      .sort((a, b) => {
        const dateA = new Date(a.uploadedAt || 0).getTime();
        const dateB = new Date(b.uploadedAt || 0).getTime();
        return dateB - dateA;
      });
  }

  /**
   * 從設定讀取快取時間
   */
  private getCacheDuration(): number {
    try {
      const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('cache_duration') as { value: string } | undefined;
      if (setting) {
        const duration = parseInt(setting.value, 10);
        return isNaN(duration) ? 24 * 60 * 60 * 1000 : duration; // 預設 24 小時
      }
    } catch (error) {
      logger.warn('Failed to get cache_duration setting:', error);
    }
    return 24 * 60 * 60 * 1000; // 預設 24 小時
  }

  /**
   * 獲取首頁推薦（頻道分區）
   * @param page 頁碼（從 0 開始）
   * @param pageSize 每頁頻道數量
   * @returns 頻道推薦列表
   */
  async getChannelRecommendations(
    page: number = 0,
    pageSize: number = 5,
    options: RecommendationOptions = {}
  ): Promise<ChannelRecommendationPage> {
    const budget = createRecommendationBudget(options.timeoutMs ?? this.requestTimeoutMs, options.signal);
    try {
      budget.check();
      logger.info(`[Recommend] Starting recommendation generation (page: ${page}, size: ${pageSize})`);
      
      // 1. 獲取被隱藏的頻道列表
      const hiddenChannels = new Set(
        db.prepare('SELECT channel_name FROM hidden_channels')
          .all()
          .map((row: any) => row.channel_name)
      );
      logger.info(`[Recommend] Found ${hiddenChannels.size} hidden channels.`);
      
      // 2. 獲取觀看過的頻道（按權重排序）
      let channels = historyService.getWatchedChannels(100, 'popular')
        .filter(ch => !hiddenChannels.has(ch.channelName)); // 過濾隱藏的頻道

      // 舊資料相容：若 watched_channels 還沒累積，但 cached_tracks 其實已有播放歷史，從 cached_tracks 回補推薦 seed
      if (channels.length === 0) {
        logger.warn('[Recommend] watched_channels empty, falling back to cached_tracks history');
        channels = db.prepare(`
          SELECT
            channel_name as channelName,
            MAX(thumbnail) as channelThumbnail,
            COUNT(*) as watchCount,
            MAX(last_played) as lastWatchedAt,
            MIN(last_played) as firstWatchedAt
          FROM cached_tracks
          WHERE last_played > 0 AND channel_name IS NOT NULL AND TRIM(channel_name) != ''
          GROUP BY channel_name
          ORDER BY MAX(last_played) DESC, COUNT(*) DESC
          LIMIT 100
        `).all().map((row: any) => ({
          ...row,
          channelId: '',
        })).filter((ch: any) => !hiddenChannels.has(ch.channelName));
      }

      // 使用者可能已經有收藏，但還沒有完整播放完成紀錄；收藏也應能作為首頁推薦 seed。
      if (channels.length === 0) {
        logger.warn('[Recommend] cached_tracks history empty, falling back to favorites');
        channels = db.prepare(`
          SELECT
            channel as channelName,
            MAX(thumbnail) as channelThumbnail,
            COUNT(*) as watchCount,
            MAX(favorited_at) as lastWatchedAt,
            MIN(favorited_at) as firstWatchedAt
          FROM favorites
          WHERE channel IS NOT NULL AND TRIM(channel) != ''
          GROUP BY channel
          ORDER BY MAX(favorited_at) DESC, COUNT(*) DESC
          LIMIT 100
        `).all().map((row: any) => ({
          ...row,
          channelId: '',
        })).filter((ch: any) => !hiddenChannels.has(ch.channelName));
      }

      logger.info(`[Recommend] Found ${channels.length} watched channels (after filtering hidden).`);

      if (channels.length === 0) {
        logger.warn('[Recommend] No watch history found. Cannot generate recommendations.');
        return { recommendations: [], hasMore: false };
      }

      // 3. 加權隨機排序（不再固定順序）
      // 結合最近播放時間 + 播放次數 + 隨機因子
      const scoredChannels = channels.map(ch => {
        const recency = ch.lastWatchedAt / Date.now(); // 0~1, 越新越高
        const popularity = Math.min(ch.watchCount / 20, 1); // 0~1, 播放越多越高
        const random = Math.random() * 0.4; // 0~0.4 隨機擾動
        return {
          ...ch,
          score: recency * 0.4 + popularity * 0.2 + random,
        };
      });

      scoredChannels.sort((a, b) => b.score - a.score);
      logger.info(`[Recommend] Scored ${scoredChannels.length} channels with randomness.`);

      // 4. 判斷是否需要進入 AI 發現模式 (Discovery Mode)
      // 如果請求的頁碼超出了現有歷史頻道的範圍
      const historyPageCount = Math.ceil(scoredChannels.length / pageSize);
      
      if (page >= historyPageCount) {
        logger.info(`[Recommend] History exhausted (page ${page} >= ${historyPageCount}). Entering AI Discovery Mode.`);
        const discovery = await this.getDiscoveryRecommendations(page, pageSize, channels.map(c => c.channelName), budget);
        return {
          recommendations: discovery,
          hasMore: discovery.length === pageSize,
        };
      }

      // Inspect every eligible cache first. A slow uncached channel must not
      // prevent already available, valid recommendations from reaching the user.
      const startIndex = page * pageSize;
      const candidates = scoredChannels.slice(startIndex);
      const collected: ChannelRecommendation[] = [];
      const uncached: typeof candidates = [];
      const section = (channel: typeof candidates[number], videos: YouTubeSearchResult[]): ChannelRecommendation => ({
        channelName: channel.channelName,
        channelThumbnail: channel.channelThumbnail,
        videos: videos.slice(0, this.VIDEOS_PER_CHANNEL),
        watchCount: channel.watchCount,
        hasMoreVideos: videos.length > this.VIDEOS_PER_CHANNEL,
      });
      for (const channel of candidates) {
        const cached = this.getCachedRecommendations(channel.channelName);
        const normalized = cached ? this.normalizeChannelVideos(cached) : [];
        if (normalized.length > 0) collected.push(section(channel, normalized));
        else uncached.push(channel);
        if (collected.length >= pageSize) break;
      }
      let cursor = 0;
      let failed = 0;
      while (cursor < uncached.length && collected.length < pageSize && !budget.signal.aborted) {
        // Only schedule the missing sections, in groups of at most five. Queue
        // waits and subsequent attempts spend the same overall request budget.
        const batch = uncached.slice(cursor, cursor + Math.min(5, pageSize - collected.length));
        cursor += batch.length;
        const results = await Promise.allSettled(batch.map(channel => channelFetchLimit(async () => {
          budget.check();
          const videos = await youtubeService.getChannelVideos(
            channel.channelName, this.VIDEOS_PER_CHANNEL + 1,
            { signal: budget.signal, timeoutMs: Math.min(this.channelFetchTimeoutMs, budget.remainingMs()), throwOnError: true }
          );
          const sorted = this.normalizeChannelVideos(videos);
          if (sorted.length > 0) this.cacheRecommendations(channel.channelName, sorted);
          return section(channel, sorted);
        }, budget.signal)));
        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.videos.length > 0) collected.push(result.value);
          else if (result.status === 'rejected') failed++;
        }
      }
      if (collected.length === 0 && (budget.signal.aborted || failed > 0)) {
        throw new RecommendationUnavailableError('Recommendation sources are unavailable; please retry');
      }
      return {
        recommendations: collected,
        hasMore: startIndex + pageSize < scoredChannels.length || cursor < uncached.length || budget.signal.aborted,
        partial: budget.signal.aborted || failed > 0,
      };
    } catch (error) {
      logger.error('Failed to get channel recommendations:', error);
      throw error;
    } finally {
      budget.dispose();
    }
  }

  /**
   * AI 發現模式：使用 Gemini 生成推薦
   */
  private async getDiscoveryRecommendations(
    page: number,
    pageSize: number,
    listenedArtists: string[],
    budget: ReturnType<typeof createRecommendationBudget>
  ): Promise<ChannelRecommendation[]> {
    try {
      const gemini = require('./gemini.service');
      
      // 生成探索個人檔案（基於最近播放）
      const recentHistory = db.prepare(`
        SELECT DISTINCT artist FROM cached_tracks 
        ORDER BY last_played DESC LIMIT 10
      `).all().map((r: any) => r.artist).filter(Boolean);

      // 如果歷史太少，補一些熱門種子
      const seedArtists = recentHistory.length >= 3 ? recentHistory : [...listenedArtists, '米津玄師', 'BTS', 'Taylor Swift'].slice(0, 5);

      // 生成發現關鍵字
      logger.info(`[Recommend] Generating discovery queries via Gemini using seeds: ${seedArtists.join(', ')}`);
      const queries = await waitWithinBudget<string[]>(gemini.generateDiscoveryQueries({
        preferredMoods: { 'energetic': 5, 'chill': 3 },
        preferredGenres: { 'Pop': 5, 'J-Pop': 3 }
      }, seedArtists, { signal: budget.signal, timeoutMs: budget.remainingMs() }), budget.signal);
      budget.check();

      const effectiveQueries = (queries && queries.length > 0) ? queries : ['Trending music 2024', 'Recommended artists'];

      // 根據頁碼輪詢關鍵字
      const targetQuery = effectiveQueries[page % effectiveQueries.length];
      logger.info(`[Recommend] Discovery mode - Page ${page} using query: "${targetQuery}"`);

      // 執行搜尋
      const tracks = this.normalizeChannelVideos(await youtubeService.search(targetQuery, pageSize * 4, {
        signal: budget.signal, timeoutMs: budget.remainingMs(),
      }));
      budget.check();
      
      // 將搜尋結果按頻道分組，並過濾掉已聽過的頻道
      const listenedSet = new Set(listenedArtists);
      const channelGroups = new Map<string, YouTubeSearchResult[]>();
      
      tracks.forEach(t => {
        if (listenedSet.has(t.channel)) return; // 跳過已聽過的
        if (!channelGroups.has(t.channel)) {
          channelGroups.set(t.channel, []);
        }
        if (channelGroups.get(t.channel)!.length < this.VIDEOS_PER_CHANNEL) {
          channelGroups.get(t.channel)!.push(t);
        }
      });

      // 轉換為 ChannelRecommendation 格式
      const results: ChannelRecommendation[] = [];
      const sortedChannels = Array.from(channelGroups.entries())
        .sort(() => Math.random() - 0.5); // 打亂順序增加隨機感

      for (const [name, videos] of sortedChannels) {
        if (results.length >= pageSize) break;
        results.push({
          channelName: name,
          channelThumbnail: videos[0]?.thumbnail || '',
          videos: videos,
          watchCount: 0 // 標識為發現模式
        });
      }

      logger.info(`[Recommend] Discovery mode produced ${results.length} new channel recommendations.`);
      return results;
    } catch (error) {
      logger.error('[Recommend] Discovery Mode failed:', error);
      throw new RecommendationUnavailableError('Discovery recommendations are unavailable; please retry');
    }
  }

  // calculateChannelScore removed — scoring now inline with randomness

  /**
   * 從快取獲取推薦
   */
  private getCachedRecommendations(channelName: string): YouTubeSearchResult[] | null {
    try {
      const now = Date.now();

      const cached = db.prepare(
        `SELECT videos_json as videosJson
         FROM recommendations_cache
         WHERE channel_name = ? AND expires_at > ?`
      ).get(channelName, now) as { videosJson: string } | undefined;

      if (cached) {
        return JSON.parse(cached.videosJson);
      }

      return null;
    } catch (error) {
      logger.warn('Failed to get cached recommendations:', error);
      return null;
    }
  }

  /**
   * 快取推薦結果
   */
  private cacheRecommendations(channelName: string, videos: YouTubeSearchResult[]): void {
    try {
      const now = Date.now();
      const cacheDuration = this.getCacheDuration();
      const expiresAt = now + cacheDuration;
      const id = `${channelName}-${now}`;

      db.prepare(
        `INSERT OR REPLACE INTO recommendations_cache
         (id, channel_name, videos_json, cached_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        id,
        channelName,
        JSON.stringify(videos),
        now,
        expiresAt
      );

      const hours = (cacheDuration / (60 * 60 * 1000)).toFixed(1);
      logger.info(`Cached recommendations for ${channelName} (expires in ${hours} hours)`);
    } catch (error) {
      logger.warn('Failed to cache recommendations:', error);
    }
  }

  /**
   * 清理過期的推薦快取
   */
  cleanExpiredCache(): void {
    try {
      const now = Date.now();

      const result = db.prepare(
        'DELETE FROM recommendations_cache WHERE expires_at <= ?'
      ).run(now);

      if (result.changes > 0) {
        logger.info(`Cleaned ${result.changes} expired recommendation cache entries`);
      }
    } catch (error) {
      logger.warn('Failed to clean expired cache:', error);
    }
  }

  /**
   * 獲取單一頻道的影片（不使用快取）
   */
  async getChannelVideos(channelName: string, limit: number = 20): Promise<YouTubeSearchResult[]> {
    try {
      return await youtubeService.getChannelVideos(channelName, limit);
    } catch (error) {
      logger.error(`Failed to get channel videos for ${channelName}:`, error);
      return [];
    }
  }

  /**
   * 刷新推薦（清除快取）
   */
  refreshRecommendations(): void {
    try {
      db.prepare('DELETE FROM recommendations_cache').run();
      logger.info('Cleared all recommendation cache');
    } catch (error) {
      logger.error('Failed to refresh recommendations:', error);
      throw error;
    }
  }

  /**
   * 獲取推薦統計
   */
  getStats(): { cachedChannels: number; totalVideos: number } {
    try {
      const now = Date.now();

      const cachedChannels = db.prepare(
        'SELECT COUNT(*) as count FROM recommendations_cache WHERE expires_at > ?'
      ).get(now) as { count: number };

      const totalVideos = db.prepare(
        'SELECT COUNT(*) as count FROM channel_videos_cache WHERE cached_at > ?'
      ).get(now - 24 * 60 * 60 * 1000) as { count: number };

      return {
        cachedChannels: cachedChannels.count,
        totalVideos: totalVideos.count,
      };
    } catch (error) {
      logger.error('Failed to get recommendation stats:', error);
      return { cachedChannels: 0, totalVideos: 0 };
    }
  }
}

export { RecommendationService };
export default new RecommendationService();
