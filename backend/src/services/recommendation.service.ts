import { db } from '../config/database';
import { ChannelRecommendation, WatchedChannel } from '../types/history.types';
import { YouTubeSearchResult } from '../types/youtube.types';
import historyService from './history.service';
import youtubeService from './youtube.service';
import logger from '../utils/logger';

/**
 * 推薦服務
 * 負責生成基於觀看歷史的推薦內容
 */
class RecommendationService {
  private readonly CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 小時
  private readonly VIDEOS_PER_CHANNEL = 5; // 每個頻道推薦 5 首影片

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
      console.log(`📊 生成推薦 (頁碼: ${page}, 每頁: ${pageSize})`);

      // 1. 獲取觀看過的頻道（按權重排序）
      const channels = historyService.getWatchedChannels(100, 'popular');

      if (channels.length === 0) {
        console.log('⚠️ 無觀看歷史，無法生成推薦');
        return [];
      }

      // 2. 計算權重並排序
      const scoredChannels = channels.map(ch => ({
        ...ch,
        score: this.calculateChannelScore(ch)
      }));

      scoredChannels.sort((a, b) => b.score - a.score);

      // 3. 分頁
      const pageChannels = scoredChannels.slice(
        page * pageSize,
        (page + 1) * pageSize
      );

      console.log(`📺 選擇 ${pageChannels.length} 個頻道生成推薦`);

      // 4. 為每個頻道獲取影片（並發請求）
      const recommendations = await Promise.all(
        pageChannels.map(async (channel) => {
          // 檢查 6 小時快取
          const cached = this.getCachedRecommendations(channel.channelName);
          if (cached) {
            console.log(`✅ 使用推薦快取: ${channel.channelName}`);
            return {
              channelName: channel.channelName,
              channelThumbnail: channel.channelThumbnail,
              videos: cached,
              watchCount: channel.watchCount
            };
          }

          // 獲取新影片
          console.log(`⏳ 獲取頻道影片: ${channel.channelName}`);
          const videos = await youtubeService.getChannelVideos(
            channel.channelName,
            this.VIDEOS_PER_CHANNEL
          );

          // 快取結果（6 小時）
          if (videos.length > 0) {
            this.cacheRecommendations(channel.channelName, videos);
          }

          return {
            channelName: channel.channelName,
            channelThumbnail: channel.channelThumbnail,
            videos,
            watchCount: channel.watchCount
          };
        })
      );

      // 5. 過濾掉沒有影片的頻道
      const validRecommendations = recommendations.filter(r => r.videos.length > 0);

      console.log(`✅ 生成 ${validRecommendations.length} 個頻道推薦`);

      return validRecommendations;
    } catch (error) {
      logger.error('Failed to get channel recommendations:', error);
      return [];
    }
  }

  /**
   * 計算頻道權重分數
   * 混合時間衰減（60%）和觀看次數（40%）
   */
  private calculateChannelScore(channel: WatchedChannel): number {
    const now = Date.now();
    const daysSinceLastWatch = (now - channel.lastWatchedAt) / (24 * 60 * 60 * 1000);

    // 時間衰減因子（7天半衰期）
    const recencyScore = Math.exp(-daysSinceLastWatch / 7);

    // 觀看次數對數化（避免極端值）
    const popularityScore = Math.log(channel.watchCount + 1);

    // 混合權重：60% 新鮮度 + 40% 流行度
    const score = recencyScore * 0.6 + popularityScore * 0.4;

    return score;
  }

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
      const expiresAt = now + this.CACHE_DURATION;
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

      logger.info(`Cached recommendations for ${channelName} (expires in 6 hours)`);
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
