import ytdl from '@distube/ytdl-core';
import YouTube from 'youtube-sr';
import youtubedl from 'youtube-dl-exec';
import { YouTubeSearchResult, YouTubeStreamInfo, StreamOptions } from '../types/youtube.types';
import logger from '../utils/logger';

class YouTubeService {
  /**
   * 搜尋 YouTube 影片（使用爬蟲，無需 API Key）
   */
  async search(query: string, limit: number = 20): Promise<YouTubeSearchResult[]> {
    try {
      logger.info(`Searching YouTube for: ${query}`);

      const results = await YouTube.search(query, {
        limit,
        type: 'video',
      });

      const tracks: YouTubeSearchResult[] = results.map((video) => ({
        id: video.id || '',
        videoId: video.id || '',
        title: video.title || 'Unknown Title',
        channel: video.channel?.name || 'Unknown Channel',
        duration: this.parseDuration(video.duration),
        thumbnail: video.thumbnail?.url || '',
        views: video.views,
        uploadedAt: video.uploadedAt,
      }));

      logger.info(`Found ${tracks.length} results for: ${query}`);
      return tracks;
    } catch (error) {
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
   * 獲取音訊串流（用於播放）- 使用 yt-dlp
   */
  async getAudioStreamUrl(videoId: string): Promise<string> {
    try {
      logger.info(`Getting audio URL via yt-dlp for: ${videoId}`);

      const result: any = await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        addHeader: ['referer:youtube.com', 'user-agent:Mozilla/5.0'],
        format: 'bestaudio',
      });

      // 從結果中獲取音訊 URL
      const audioUrl = result?.url || result?.formats?.find((f: any) => f.acodec !== 'none')?.url;

      if (!audioUrl) {
        throw new Error('No audio URL found');
      }

      logger.info(`Successfully got audio URL for ${videoId}`);
      return audioUrl;
    } catch (error) {
      logger.error(`yt-dlp failed for ${videoId}:`, error);
      throw new Error(`Failed to get audio URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
   * 解析時長字串為秒數
   * 例如: "3:45" -> 225, "1:02:30" -> 3750, 254320 (毫秒) -> 254
   */
  private parseDuration(duration: string | number | null): number {
    if (!duration) return 0;

    // 如果是數字
    if (typeof duration === 'number') {
      // youtube-sr 返回毫秒，如果數字很大（>10000），當作毫秒處理
      if (duration > 10000) {
        return Math.floor(duration / 1000);
      }
      return duration;
    }

    // 如果是字串，解析時間格式 (MM:SS 或 HH:MM:SS)
    try {
      const parts = duration.toString().split(':').reverse();
      let seconds = 0;

      parts.forEach((part, index) => {
        seconds += parseInt(part, 10) * Math.pow(60, index);
      });

      return seconds;
    } catch (error) {
      logger.warn(`Failed to parse duration: ${duration}`);
      return 0;
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
}

export default new YouTubeService();
