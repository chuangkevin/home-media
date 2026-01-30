import ytdl from '@distube/ytdl-core';
import youtubedl from 'youtube-dl-exec';
import fs from 'fs';
import { YouTubeSearchResult, YouTubeStreamInfo, StreamOptions } from '../types/youtube.types';
import logger from '../utils/logger';
import config from '../config/environment';

interface CachedUrl {
  url: string;
  timestamp: number;
}

class YouTubeService {
  private urlCache: Map<string, CachedUrl> = new Map();
  private pendingRequests: Map<string, Promise<string>> = new Map(); // 防止重複請求
  private readonly URL_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 小時（YouTube URL 有效期）
  private readonly SEARCH_CACHE_TTL = 60 * 60 * 1000; // 1 小時（搜尋結果快取）
  private cookiesPath: string | null = null;

  constructor() {
    // 檢查 cookies 文件是否存在
    if (config.youtube?.cookiesPath && fs.existsSync(config.youtube.cookiesPath)) {
      this.cookiesPath = config.youtube.cookiesPath;
      logger.info(`📍 YouTube cookies 已配置: ${this.cookiesPath}`);
    } else if (config.youtube?.cookiesPath) {
      logger.warn(`⚠️ YouTube cookies 路徑不存在: ${config.youtube.cookiesPath}`);
    }
  }

  /**
   * 獲取 yt-dlp 基本選項（包含 cookies）
   */
  private getYtDlpBaseOptions(): Record<string, any> {
    const baseOptions: Record<string, any> = {
      noCheckCertificates: true,
      noWarnings: true,
      addHeader: [
        'Accept-Language:zh-TW,zh;q=0.9',
        'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ],
    };

    // 如果有 cookies，加入選項
    if (this.cookiesPath) {
      baseOptions.cookies = this.cookiesPath;
      logger.debug('Using cookies for yt-dlp request');
    }

    return baseOptions;
  }

  /**
   * 搜尋 YouTube 影片（使用 yt-dlp，支援中文標題）
   * 包含搜尋結果快取以提升效能
   */
  async search(query: string, limit: number = 20): Promise<YouTubeSearchResult[]> {
    try {
      // 檢查搜尋結果快取
      const cached = this.getCachedSearchResults(query);
      if (cached && cached.length > 0) {
        console.log(`✅ 使用搜尋快取: "${query}" (${cached.length} 個結果)`);
        logger.info(`Using cached search results for: ${query}`);
        return cached;
      }

      console.log(`🔍 搜尋: ${query}`);
      logger.info(`Searching YouTube for: ${query}`);

      const startTime = Date.now();

      // 使用 yt-dlp 搜尋，指定台灣地區以獲取中文標題
      const result: any = await youtubedl(`ytsearch${limit}:${query}`, {
        ...this.getYtDlpBaseOptions(),
        dumpSingleJson: true,
        flatPlaylist: true,
        geoBypassCountry: 'TW', // 台灣地區
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

      // 快取搜尋結果
      if (tracks.length > 0) {
        this.cacheSearchResults(query, tracks);
      }

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
   * 從資料庫獲取快取的搜尋結果
   */
  private getCachedSearchResults(query: string): YouTubeSearchResult[] | null {
    try {
      const { db } = require('../config/database');
      const now = Date.now();

      const result = db.prepare(
        `SELECT results_json FROM search_results_cache
         WHERE query = ? AND expires_at > ?
         LIMIT 1`
      ).get(query.toLowerCase(), now) as { results_json: string } | undefined;

      if (result) {
        return JSON.parse(result.results_json);
      }
      return null;
    } catch (error) {
      logger.warn('Failed to get cached search results:', error);
      return null;
    }
  }

  /**
   * 快取搜尋結果到資料庫
   */
  private cacheSearchResults(query: string, results: YouTubeSearchResult[]): void {
    try {
      const { db } = require('../config/database');
      const now = Date.now();
      const expiresAt = now + this.SEARCH_CACHE_TTL;
      const id = `search_${query.toLowerCase()}_${now}`;

      db.prepare(
        `INSERT OR REPLACE INTO search_results_cache
         (id, query, results_json, result_count, cached_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, query.toLowerCase(), JSON.stringify(results), results.length, now, expiresAt);

      logger.info(`Cached search results for: ${query} (${results.length} results)`);
    } catch (error) {
      logger.warn('Failed to cache search results:', error);
    }
  }

  /**
   * 清理過期的搜尋結果快取
   */
  cleanExpiredSearchCache(): void {
    try {
      const { db } = require('../config/database');
      const now = Date.now();

      const result = db.prepare(
        'DELETE FROM search_results_cache WHERE expires_at <= ?'
      ).run(now);

      if (result.changes > 0) {
        logger.info(`Cleaned ${result.changes} expired search cache entries`);
      }
    } catch (error) {
      logger.warn('Failed to clean expired search cache:', error);
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
   * 獲取音訊串流（用於播放）- 使用 yt-dlp + 緩存 + 請求去重
   */
  async getAudioStreamUrl(videoId: string): Promise<string> {
    // 檢查緩存
    const cached = this.urlCache.get(videoId);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < this.URL_CACHE_TTL) {
      const ageMinutes = Math.floor((now - cached.timestamp) / 1000 / 60);
      console.log(`✅ 使用緩存 URL: ${videoId} (快取時間: ${ageMinutes}分鐘)`);
      logger.info(`Using cached audio URL for: ${videoId} (age: ${ageMinutes}min)`);
      return cached.url;
    }

    // 檢查是否有正在進行的請求（請求去重）
    const pendingRequest = this.pendingRequests.get(videoId);
    if (pendingRequest) {
      console.log(`⏳ 等待現有請求完成: ${videoId}`);
      logger.info(`Waiting for pending request for: ${videoId}`);
      return pendingRequest;
    }

    // 創建新請求並加入 pending map
    const requestPromise = this.fetchAudioUrl(videoId);
    this.pendingRequests.set(videoId, requestPromise);

    try {
      const url = await requestPromise;
      return url;
    } finally {
      // 無論成功或失敗，都要清除 pending 狀態
      this.pendingRequests.delete(videoId);
    }
  }

  /**
   * 實際執行 yt-dlp 獲取 URL（內部方法）
   */
  private async fetchAudioUrl(videoId: string): Promise<string> {
    try {
      console.log(`⏳ 首次播放，正在獲取 URL: ${videoId} (這需要幾秒鐘...)`);
      logger.info(`Fetching fresh audio URL via yt-dlp for: ${videoId}`);

      const startTime = Date.now();
      // 優先選擇 m4a/aac 格式，這在手機瀏覽器上相容性更好
      // bestaudio[ext=m4a] 優先，fallback 到 bestaudio
      const result: any = await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
        ...this.getYtDlpBaseOptions(),
        dumpSingleJson: true,
        preferFreeFormats: false, // 不優先免費格式，優先相容性
        format: 'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio',
      });
      const fetchTime = ((Date.now() - startTime) / 1000).toFixed(2);

      // 從結果中獲取音訊 URL
      const audioUrl = result?.url || result?.formats?.find((f: any) => f.acodec !== 'none')?.url;

      if (!audioUrl) {
        throw new Error('No audio URL found');
      }

      // 緩存 URL
      const now = Date.now();
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
   * 獲取 yt-dlp 二進位路徑
   */
  getYtDlpPath(): string {
    const constants = require('youtube-dl-exec').constants;
    return constants.YOUTUBE_DL_PATH;
  }

  /**
   * 獲取 cookies 路徑（供外部使用）
   */
  getCookiesFilePath(): string | null {
    return this.cookiesPath;
  }

  /**
   * 組裝 yt-dlp 基本命令行參數（用於 child_process.spawn）
   */
  getYtDlpBaseArgs(): string[] {
    const args: string[] = [
      '--no-check-certificates',
      '--no-warnings',
      '--add-header', 'Accept-Language:zh-TW,zh;q=0.9',
      '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ];

    if (this.cookiesPath) {
      args.push('--cookies', this.cookiesPath);
    }

    return args;
  }

  /**
   * 清空所有緩存
   */
  clearCache(): void {
    this.urlCache.clear();
    logger.info('Cleared all URL cache');
  }

  /**
   * 清除特定影片的 URL 緩存
   */
  clearUrlCache(videoId: string): void {
    if (this.urlCache.has(videoId)) {
      this.urlCache.delete(videoId);
      console.log(`🗑️ 清除 URL 緩存: ${videoId}`);
      logger.info(`Cleared URL cache for: ${videoId}`);
    }
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
        ...this.getYtDlpBaseOptions(),
        dumpSingleJson: true,
        flatPlaylist: true,
        geoBypassCountry: 'TW',
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
