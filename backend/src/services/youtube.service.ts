import ytdl from '@distube/ytdl-core';
import youtubedl from 'youtube-dl-exec';
import { YouTubeSearchResult, YouTubeStreamInfo, StreamOptions } from '../types/youtube.types';
import logger from '../utils/logger';

interface CachedUrl {
  url: string;
  timestamp: number;
}

class YouTubeService {
  private urlCache: Map<string, CachedUrl> = new Map();
  private readonly URL_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 小時（YouTube URL 有效期）
  /**
   * 搜尋 YouTube 影片（使用 yt-dlp，支援中文標題）
   */
  async search(query: string, limit: number = 20): Promise<YouTubeSearchResult[]> {
    try {
      console.log(`🔍 搜尋: ${query}`);
      logger.info(`Searching YouTube for: ${query}`);

      const startTime = Date.now();

      // 使用 yt-dlp 搜尋，指定台灣地區以獲取中文標題
      const result: any = await youtubedl(`ytsearch${limit}:${query}`, {
        dumpSingleJson: true,
        flatPlaylist: true,
        noCheckCertificates: true,
        noWarnings: true,
        geoBypassCountry: 'TW', // 台灣地區
        addHeader: [
          'Accept-Language:zh-TW,zh;q=0.9',
          'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ],
        extractorArgs: 'youtube:lang=zh-TW', // 強制使用繁體中文
      } as any);

      const searchTime = ((Date.now() - startTime) / 1000).toFixed(2);

      // yt-dlp 返回的是一個包含 entries 的物件
      const entries = result?.entries || [];

      // 過濾掉非影片結果（頻道 ID 以 UC 開頭，影片 ID 為 11 字元）
      const videoEntries = entries.filter((video: any) => {
        const id = video.id || '';
        // 影片 ID 為 11 字元，且不以 UC 開頭（頻道）
        return id.length === 11 && !id.startsWith('UC');
      });

      const tracks: YouTubeSearchResult[] = videoEntries.map((video: any) => ({
        id: video.id || '',
        videoId: video.id || '',
        title: video.title || 'Unknown Title',
        channel: video.channel || video.uploader || 'Unknown Channel',
        duration: video.duration || 0,
        thumbnail: video.thumbnail || video.thumbnails?.[0]?.url || '',
        views: video.view_count,
        uploadedAt: video.upload_date,
      }));

      console.log(`✅ 找到 ${tracks.length} 個結果 (耗時: ${searchTime}秒)`);
      logger.info(`Found ${tracks.length} results for: ${query} in ${searchTime}s`);
      return tracks;
    } catch (error) {
      console.error(`❌ 搜尋失敗:`, error);
      logger.error('YouTube search error:', error);
      throw new Error(`Failed to search YouTube: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 獲取影片資訊（不下載）
   */
  async getVideoInfo(videoId: string): Promise<YouTubeStreamInfo> {
    try {
      logger.info(`Getting video info for: ${videoId}`);

      const info = await ytdl.getInfo(videoId);
      const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

      return {
        videoId,
        title: info.videoDetails.title,
        duration: parseInt(info.videoDetails.lengthSeconds, 10),
        formats: audioFormats.map((format) => ({
          itag: format.itag,
          mimeType: format.mimeType || '',
          bitrate: format.bitrate || 0,
          audioQuality: format.audioQuality || '',
          url: format.url,
        })),
      };
    } catch (error) {
      logger.error(`Failed to get video info for ${videoId}:`, error);
      throw new Error(`Failed to get video info: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 獲取音訊串流（用於播放）- 使用 yt-dlp + 緩存
   */
  async getAudioStreamUrl(videoId: string): Promise<string> {
    try {
      // 檢查緩存
      const cached = this.urlCache.get(videoId);
      const now = Date.now();

      if (cached && (now - cached.timestamp) < this.URL_CACHE_TTL) {
        const ageMinutes = Math.floor((now - cached.timestamp) / 1000 / 60);
        console.log(`✅ 使用緩存 URL: ${videoId} (快取時間: ${ageMinutes}分鐘)`);
        logger.info(`Using cached audio URL for: ${videoId} (age: ${ageMinutes}min)`);
        return cached.url;
      }

      console.log(`⏳ 首次播放，正在獲取 URL: ${videoId} (這需要幾秒鐘...)`);
      logger.info(`Fetching fresh audio URL via yt-dlp for: ${videoId}`);

      const startTime = Date.now();
      const result: any = await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        addHeader: ['referer:youtube.com', 'user-agent:Mozilla/5.0'],
        format: 'bestaudio',
      });
      const fetchTime = ((Date.now() - startTime) / 1000).toFixed(2);

      // 從結果中獲取音訊 URL
      const audioUrl = result?.url || result?.formats?.find((f: any) => f.acodec !== 'none')?.url;

      if (!audioUrl) {
        throw new Error('No audio URL found');
      }

      // 緩存 URL
      this.urlCache.set(videoId, {
        url: audioUrl,
        timestamp: now,
      });

      console.log(`✅ URL 獲取成功並已緩存: ${videoId} (耗時: ${fetchTime}秒, 緩存數: ${this.urlCache.size})`);
      logger.info(`Successfully got and cached audio URL for ${videoId} (took ${fetchTime}s, cache size: ${this.urlCache.size})`);

      // 清理過期緩存
      this.cleanExpiredCache();

      return audioUrl;
    } catch (error) {
      console.error(`❌ 獲取 URL 失敗: ${videoId}`, error);
      logger.error(`yt-dlp failed for ${videoId}:`, error);
      throw new Error(`Failed to get audio URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 清理過期的 URL 緩存
   */
  private cleanExpiredCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [videoId, cached] of this.urlCache.entries()) {
      if (now - cached.timestamp >= this.URL_CACHE_TTL) {
        this.urlCache.delete(videoId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned ${cleaned} expired URLs from cache (remaining: ${this.urlCache.size})`);
    }
  }

  /**
   * 清空所有緩存
   */
  clearCache(): void {
    this.urlCache.clear();
    logger.info('Cleared all URL cache');
  }

  /**
   * 獲取音訊串流（用於播放）- 雙重機制
   * 先嘗試 ytdl-core，失敗則使用 yt-dlp
   */
  getAudioStream(videoId: string, options: StreamOptions = {}) {
    try {
      logger.info(`Creating audio stream for: ${videoId}`);

      const streamOptions: ytdl.downloadOptions = {
        filter: options.filter || 'audioonly',
        quality: options.quality || 'highestaudio',
        highWaterMark: 1 << 25, // 32MB buffer for smooth streaming
        // 添加額外選項嘗試繞過 YouTube 限制
        requestOptions: {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        },
      };

      const stream = ytdl(videoId, streamOptions);

      // 監聽錯誤，如果 ytdl-core 失敗會在 controller 中處理
      stream.on('error', (error) => {
        logger.error(`ytdl-core stream error for ${videoId}:`, error);
      });

      return stream;
    } catch (error) {
      logger.error(`Failed to create stream for ${videoId}:`, error);
      throw new Error(`Failed to create audio stream: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 驗證影片 ID 是否有效
   */
  async validateVideoId(videoId: string): Promise<boolean> {
    try {
      return ytdl.validateID(videoId);
    } catch (error) {
      return false;
    }
  }

  /**
   * 從 URL 提取影片 ID
   */
  extractVideoId(url: string): string | null {
    try {
      return ytdl.getVideoID(url);
    } catch (error) {
      return null;
    }
  }

  /**
   * 格式化秒數為時長字串
   * 例如: 225 -> "3:45", 3750 -> "1:02:30"
   */
  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * 獲取頻道影片（使用搜尋過濾策略）
   * @param channelName 頻道名稱
   * @param limit 返回數量
   * @returns 該頻道的影片列表
   */
  async getChannelVideos(channelName: string, limit: number = 20): Promise<YouTubeSearchResult[]> {
    try {
      // 1. 檢查 24 小時快取
      const cached = this.getCachedChannelVideos(channelName, limit);
      if (cached && cached.length > 0) {
        const cacheAge = Math.floor((Date.now() - cached[0].cachedAt) / 1000 / 60);
        console.log(`✅ 使用頻道影片快取: ${channelName} (快取時間: ${cacheAge}分鐘, ${cached.length} 個影片)`);
        return cached.map(c => ({
          id: c.videoId,
          videoId: c.videoId,
          title: c.title,
          channel: channelName,
          duration: c.duration,
          thumbnail: c.thumbnail,
          views: c.views,
          uploadedAt: c.uploadedAt,
        }));
      }

      console.log(`⏳ 獲取頻道影片: ${channelName} (需要搜尋...)`);

      // 2. 使用 yt-dlp 搜尋 + 過濾
      const result: any = await youtubedl(`ytsearch${limit * 3}:${channelName}`, {
        dumpSingleJson: true,
        flatPlaylist: true,
        noCheckCertificates: true,
        noWarnings: true,
        geoBypassCountry: 'TW',
        addHeader: [
          'Accept-Language:zh-TW,zh;q=0.9',
          'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ],
        extractorArgs: 'youtube:lang=zh-TW', // 強制使用繁體中文
      } as any);

      const entries = result?.entries || [];

      // 3. 過濾出該頻道的影片（排除頻道和播放清單）
      const channelVideos = entries
        .filter((video: any) => {
          const id = video.id || '';
          // 影片 ID 為 11 字元，且不以 UC 開頭（頻道）
          const isVideo = id.length === 11 && !id.startsWith('UC');
          const isFromChannel = (video.channel || video.uploader) === channelName;
          return isVideo && isFromChannel;
        })
        .slice(0, limit)
        .map((video: any) => ({
          id: video.id || '',
          videoId: video.id || '',
          title: video.title || 'Unknown Title',
          channel: channelName,
          duration: video.duration || 0,
          thumbnail: video.thumbnail || video.thumbnails?.[0]?.url || '',
          views: video.view_count,
          uploadedAt: video.upload_date,
        }));

      // 4. 快取結果
      if (channelVideos.length > 0) {
        this.cacheChannelVideos(channelName, channelVideos);
        console.log(`✅ 獲取並快取頻道影片: ${channelName} (${channelVideos.length} 個影片)`);
      }

      return channelVideos;
    } catch (error) {
      logger.error(`Failed to get channel videos for ${channelName}:`, error);
      return [];
    }
  }

  /**
   * 從資料庫獲取快取的頻道影片
   */
  private getCachedChannelVideos(channelName: string, limit: number): any[] {
    try {
      const { db } = require('../config/database');
      const now = Date.now();
      const cacheExpiry = 24 * 60 * 60 * 1000; // 24 小時

      const stmt = db.prepare(
        `SELECT video_id as videoId, title, thumbnail, duration, views, uploaded_at as uploadedAt, cached_at as cachedAt
         FROM channel_videos_cache
         WHERE channel_name = ? AND cached_at > ?
         ORDER BY cached_at DESC
         LIMIT ?`
      );

      return stmt.all(channelName, now - cacheExpiry, limit);
    } catch (error) {
      logger.warn('Failed to get cached channel videos:', error);
      return [];
    }
  }

  /**
   * 快取頻道影片到資料庫
   */
  private cacheChannelVideos(channelName: string, videos: YouTubeSearchResult[]): void {
    try {
      const { db } = require('../config/database');
      const now = Date.now();

      const stmt = db.prepare(
        `INSERT OR REPLACE INTO channel_videos_cache
         (channel_name, video_id, title, thumbnail, duration, views, uploaded_at, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const insertMany = db.transaction((videos: YouTubeSearchResult[]) => {
        for (const video of videos) {
          stmt.run(
            channelName,
            video.videoId,
            video.title,
            video.thumbnail,
            video.duration,
            video.views || 0,
            video.uploadedAt || '',
            now
          );
        }
      });

      insertMany(videos);
    } catch (error) {
      logger.warn('Failed to cache channel videos:', error);
    }
  }

  /**
   * 清理過期的頻道影片快取
   */
  cleanExpiredChannelCache(): void {
    try {
      const { db } = require('../config/database');
      const now = Date.now();
      const cacheExpiry = 24 * 60 * 60 * 1000; // 24 小時

      const result = db.prepare(
        'DELETE FROM channel_videos_cache WHERE cached_at <= ?'
      ).run(now - cacheExpiry);

      if (result.changes > 0) {
        logger.info(`Cleaned ${result.changes} expired channel video cache entries`);
      }
    } catch (error) {
      logger.warn('Failed to clean expired channel cache:', error);
    }
  }
}

export default new YouTubeService();
