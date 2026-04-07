import { db } from '../config/database';
import { ChannelRecommendation } from '../types/history.types';
import { YouTubeSearchResult } from '../types/youtube.types';
import historyService from './history.service';
import youtubeService from './youtube.service';
import logger from '../utils/logger';

/**
 * 推薦服務
 * 負責生成基於觀看歷史的推薦內容
 */
class RecommendationService {
  private readonly VIDEOS_PER_CHANNEL = 5; // 每個頻道推薦 5 首影片

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
    pageSize: number = 5
  ): Promise<ChannelRecommendation[]> {
    try {
      logger.info(`[Recommend] Starting recommendation generation (page: ${page}, size: ${pageSize})`);
      
      // 1. 獲取被隱藏的頻道列表
      const hiddenChannels = new Set(
        db.prepare('SELECT channel_name FROM hidden_channels')
          .all()
          .map((row: any) => row.channel_name)
      );
      logger.info(`[Recommend] Found ${hiddenChannels.size} hidden channels.`);
      
      // 2. 獲取觀看過的頻道（按權重排序）
      const channels = historyService.getWatchedChannels(100, 'popular')
        .filter(ch => !hiddenChannels.has(ch.channelName)); // 過濾隱藏的頻道
      logger.info(`[Recommend] Found ${channels.length} watched channels (after filtering hidden).`);

      if (channels.length === 0) {
        logger.warn('[Recommend] No watch history found. Cannot generate recommendations.');
        return [];
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
        return await this.getDiscoveryRecommendations(page, pageSize, channels.map(c => c.channelName));
      }

      // 5. 分頁 (觀看歷史路徑)
      const pageChannels = scoredChannels.slice(
        page * pageSize,
        (page + 1) * pageSize
      );
      logger.info(`[Recommend] Sliced channels for current page. Found ${pageChannels.length} channels for this page.`);

      // 6. 為每個頻道獲取影片（並發請求）
      const recommendations = await Promise.all(
        pageChannels.map(async (channel) => {
          logger.info(`[Recommend] Processing channel: ${channel.channelName}`);
          // 檢查 6 小時快取
          const cached = this.getCachedRecommendations(channel.channelName);
          if (cached) {
            logger.info(`[Recommend] Cache hit for channel: ${channel.channelName}`);
            return {
              channelName: channel.channelName,
              channelThumbnail: channel.channelThumbnail,
              videos: cached,
              watchCount: channel.watchCount
            };
          }

          // 獲取新影片（3s timeout 防止 YouTube rate-limit 時 hang 住）
          logger.info(`[Recommend] No cache. Fetching videos for channel: ${channel.channelName}`);
          const videos = await Promise.race([
            youtubeService.getChannelVideos(channel.channelName, this.VIDEOS_PER_CHANNEL),
            new Promise<YouTubeSearchResult[]>(resolve => setTimeout(() => {
              logger.warn(`[Recommend] Timeout fetching videos for channel: ${channel.channelName}`);
              resolve([]);
            }, 3000)),
          ]);
          logger.info(`[Recommend] Fetched ${videos.length} videos for channel: ${channel.channelName}`);


          // 過濾掉合輯/超長影片（>10 分鐘 = 600 秒）和直播（duration=0）
          const filtered = videos.filter(v => v.duration > 0 && v.duration <= 600);

          // 快取結果（6 小時）
          if (filtered.length > 0) {
            this.cacheRecommendations(channel.channelName, filtered);
          }

          return {
            channelName: channel.channelName,
            channelThumbnail: channel.channelThumbnail,
            videos: filtered,
            watchCount: channel.watchCount
          };
        })
      );

      logger.info('[Recommend] Finished processing all channels for the page.');

      // 7. 過濾掉沒有影片的頻道
      const validRecommendations = recommendations.filter(r => r.videos.length > 0);

      logger.info(`[Recommend] Found ${validRecommendations.length} valid recommendations.`);

      return validRecommendations;
    } catch (error) {
      logger.error('Failed to get channel recommendations:', error);
      throw error;
    }
  }

  /**
   * AI 發現模式：使用 Gemini 生成推薦
   */
  private async getDiscoveryRecommendations(
    page: number,
    pageSize: number,
    listenedArtists: string[]
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
      const queries = await gemini.generateDiscoveryQueries({
        preferredMoods: { 'energetic': 5, 'chill': 3 },
        preferredGenres: { 'Pop': 5, 'J-Pop': 3 }
      }, seedArtists);
      
      const effectiveQueries = (queries && queries.length > 0) ? queries : ['Trending music 2024', 'Recommended artists'];

      // 根據頁碼輪詢關鍵字
      const targetQuery = effectiveQueries[page % effectiveQueries.length];
      logger.info(`[Recommend] Discovery mode - Page ${page} using query: "${targetQuery}"`);

      // 執行搜尋
      const tracks = await youtubeService.search(targetQuery, pageSize * 4);
      
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
      return [];
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

export default new RecommendationService();
