import { db } from '../config/database';
import { SearchHistoryItem, WatchedChannel } from '../types/history.types';
import logger from '../utils/logger';
import { randomUUID } from 'crypto';

/**
 * 歷史記錄服務
 * 負責管理搜尋歷史和觀看頻道記錄
 */
class HistoryService {
  /**
   * 記錄搜尋歷史
   * 如果查詢已存在，則更新計數和最後搜尋時間
   */
  recordSearch(query: string, resultCount: number): void {
    try {
      // 檢查資料庫連接
      if (!db) {
        throw new Error('Database connection not available');
      }

      const now = Date.now();
      const existingRecord = db.prepare(
        'SELECT * FROM search_history WHERE query = ?'
      ).get(query) as SearchHistoryItem | undefined;

      if (existingRecord) {
        // 更新現有記錄
        db.prepare(
          `UPDATE search_history
           SET search_count = search_count + 1,
               last_searched_at = ?,
               result_count = ?
           WHERE query = ?`
        ).run(now, resultCount, query);

        logger.info(`Updated search history: "${query}" (count: ${existingRecord.searchCount + 1})`);
      } else {
        // 創建新記錄
        const id = randomUUID();
        db.prepare(
          `INSERT INTO search_history
           (id, query, search_count, last_searched_at, first_searched_at, result_count)
           VALUES (?, ?, 1, ?, ?, ?)`
        ).run(id, query, now, now, resultCount);

        logger.info(`Recorded new search: "${query}"`);
      }
    } catch (error) {
      logger.error('Failed to record search history:', error);
      // 重新拋出錯誤讓 controller 處理
      throw error;
    }
  }

  /**
   * 獲取搜尋歷史
   * @param limit 返回數量限制
   * @param sortBy 排序方式：'recent' 最近搜尋，'popular' 最多搜尋
   */
  getSearchHistory(limit: number = 50, sortBy: 'recent' | 'popular' = 'recent'): SearchHistoryItem[] {
    try {
      const orderBy = sortBy === 'recent'
        ? 'last_searched_at DESC'
        : 'search_count DESC, last_searched_at DESC';

      const stmt = db.prepare(
        `SELECT id, query, search_count as searchCount,
                last_searched_at as lastSearchedAt,
                first_searched_at as firstSearchedAt,
                result_count as resultCount
         FROM search_history
         ORDER BY ${orderBy}
         LIMIT ?`
      );

      return stmt.all(limit) as SearchHistoryItem[];
    } catch (error) {
      logger.error('Failed to get search history:', error);
      return [];
    }
  }

  /**
   * 清除所有搜尋歷史
   */
  clearSearchHistory(): void {
    try {
      db.prepare('DELETE FROM search_history').run();
      logger.info('Cleared all search history');
    } catch (error) {
      logger.error('Failed to clear search history:', error);
      throw error;
    }
  }

  /**
   * 記錄頻道觀看
   * 如果頻道已存在，則更新計數和最後觀看時間
   */
  recordChannelWatch(channelName: string, channelThumbnail: string = ''): void {
    try {
      const now = Date.now();
      const existingChannel = db.prepare(
        'SELECT * FROM watched_channels WHERE channel_name = ?'
      ).get(channelName) as WatchedChannel | undefined;

      if (existingChannel) {
        // 更新現有記錄
        db.prepare(
          `UPDATE watched_channels
           SET watch_count = watch_count + 1,
               last_watched_at = ?,
               channel_thumbnail = ?
           WHERE channel_name = ?`
        ).run(now, channelThumbnail || existingChannel.channelThumbnail, channelName);

        logger.info(`Updated channel watch: "${channelName}" (count: ${existingChannel.watchCount + 1})`);
      } else {
        // 創建新記錄
        const id = randomUUID();
        db.prepare(
          `INSERT INTO watched_channels
           (id, channel_id, channel_name, channel_thumbnail, watch_count, last_watched_at, first_watched_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`
        ).run(id, '', channelName, channelThumbnail, now, now);

        logger.info(`Recorded new channel watch: "${channelName}"`);
      }
    } catch (error) {
      logger.error('Failed to record channel watch:', error);
    }
  }

  /**
   * 獲取觀看過的頻道
   * @param limit 返回數量限制
   * @param sortBy 排序方式：'recent' 最近觀看，'popular' 最多觀看
   */
  getWatchedChannels(limit: number = 50, sortBy: 'recent' | 'popular' = 'recent'): WatchedChannel[] {
    try {
      const orderBy = sortBy === 'recent'
        ? 'last_watched_at DESC'
        : 'watch_count DESC, last_watched_at DESC';

      const stmt = db.prepare(
        `SELECT id, channel_id as channelId, channel_name as channelName,
                channel_thumbnail as channelThumbnail,
                watch_count as watchCount,
                last_watched_at as lastWatchedAt,
                first_watched_at as firstWatchedAt
         FROM watched_channels
         ORDER BY ${orderBy}
         LIMIT ?`
      );

      return stmt.all(limit) as WatchedChannel[];
    } catch (error) {
      logger.error('Failed to get watched channels:', error);
      return [];
    }
  }

  /**
   * 清除所有頻道歷史
   */
  clearChannelHistory(): void {
    try {
      db.prepare('DELETE FROM watched_channels').run();
      logger.info('Cleared all channel history');
    } catch (error) {
      logger.error('Failed to clear channel history:', error);
      throw error;
    }
  }

  /**
   * 獲取統計資訊
   */
  getStats(): { searchCount: number; channelCount: number } {
    try {
      const searchCount = db.prepare('SELECT COUNT(*) as count FROM search_history').get() as { count: number };
      const channelCount = db.prepare('SELECT COUNT(*) as count FROM watched_channels').get() as { count: number };

      return {
        searchCount: searchCount.count,
        channelCount: channelCount.count,
      };
    } catch (error) {
      logger.error('Failed to get stats:', error);
      return { searchCount: 0, channelCount: 0 };
    }
  }
}

export default new HistoryService();
