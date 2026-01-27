import axios from 'axios';
import type { Track, SearchResponse } from '../types/track.types';
import type { Lyrics, LRCLIBSearchResult } from '../types/lyrics.types';

// 所有 API 請求都通過 nginx 代理 (/api)
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

class ApiService {
  private api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
  });

  /**
   * 搜尋 YouTube 音樂
   */
  async searchTracks(query: string, limit: number = 20): Promise<Track[]> {
    const response = await this.api.get<SearchResponse>('/search', {
      params: { q: query, limit },
    });
    return response.data.results;
  }

  /**
   * 獲取影片資訊
   */
  async getVideoInfo(videoId: string) {
    const response = await this.api.get(`/video/${videoId}`);
    return response.data;
  }

  /**
   * 獲取音訊串流 URL
   */
  getStreamUrl(videoId: string, quality: string = 'highestaudio'): string {
    return `${API_BASE_URL}/stream/${videoId}?quality=${quality}`;
  }

  /**
   * 預加載音訊 URL（觸發後端緩存，立即返回）
   */
  async preloadAudio(videoId: string): Promise<void> {
    try {
      await this.api.post(`/preload/${videoId}`, {}, { timeout: 30000 });
    } catch (error) {
      // 忽略預加載錯誤，不影響主流程
      console.warn(`Preload failed for ${videoId}:`, error);
    }
  }

  /**
   * 預加載音訊 URL（等待完成，用於第一首）
   */
  async preloadAudioWait(videoId: string): Promise<void> {
    await this.api.post(`/preload-wait/${videoId}`, {}, { timeout: 60000 });
  }

  /**
   * 批量預加載音訊
   */
  async preloadMultiple(videoIds: string[]): Promise<void> {
    await Promise.all(videoIds.map(id => this.preloadAudio(id)));
  }

  // ==================== 歌詞 ====================

  /**
   * 獲取歌詞
   */
  async getLyrics(videoId: string, title: string, artist?: string): Promise<Lyrics | null> {
    try {
      const response = await this.api.get<{ videoId: string; lyrics: Lyrics }>(`/lyrics/${videoId}`, {
        params: { title, artist },
        timeout: 90000, // 歌詞獲取需要較長時間（嘗試多個來源：YouTube CC、網易雲、LRCLIB、Genius）
      });
      return response.data.lyrics;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // 找不到歌詞，返回 null
        return null;
      }
      throw error;
    }
  }

  /**
   * 搜尋 LRCLIB 歌詞
   */
  async searchLyrics(query: string): Promise<LRCLIBSearchResult[]> {
    try {
      const response = await this.api.get<{ query: string; count: number; results: LRCLIBSearchResult[] }>('/lyrics/search', {
        params: { q: query },
        timeout: 45000, // 搜尋可能較慢
      });
      return response.data.results;
    } catch (error) {
      console.error('Search lyrics failed:', error);
      return [];
    }
  }

  /**
   * 透過 LRCLIB ID 獲取特定歌詞
   */
  async getLyricsByLRCLIBId(videoId: string, lrclibId: number): Promise<Lyrics | null> {
    try {
      const response = await this.api.get<{ videoId: string; lyrics: Lyrics }>(`/lyrics/lrclib/${lrclibId}`, {
        params: { videoId },
        timeout: 45000, // 獲取歌詞可能較慢
      });
      return response.data.lyrics;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  // ==================== 歷史記錄 ====================

  /**
   * 獲取搜尋歷史
   */
  async getSearchHistory(limit: number = 50, sortBy: 'recent' | 'popular' = 'recent') {
    const response = await this.api.get('/history/searches', {
      params: { limit, sortBy },
    });
    return response.data.history;
  }

  /**
   * 記錄搜尋
   */
  async recordSearch(query: string, resultCount: number): Promise<void> {
    await this.api.post('/history/search', { query, resultCount });
  }

  /**
   * 清除搜尋歷史
   */
  async clearSearchHistory(): Promise<void> {
    await this.api.delete('/history/searches');
  }

  /**
   * 獲取觀看頻道
   */
  async getWatchedChannels(limit: number = 50, sortBy: 'recent' | 'popular' = 'recent') {
    const response = await this.api.get('/history/channels', {
      params: { limit, sortBy },
    });
    return response.data.channels;
  }

  /**
   * 記錄頻道觀看
   */
  async recordChannelWatch(channelName: string, channelThumbnail: string = ''): Promise<void> {
    await this.api.post('/history/channel', { channelName, channelThumbnail });
  }

  /**
   * 清除頻道歷史
   */
  async clearChannelHistory(): Promise<void> {
    await this.api.delete('/history/channels');
  }

  // ==================== 推薦系統 ====================

  /**
   * 獲取頻道推薦
   */
  async getChannelRecommendations(page: number = 0, pageSize: number = 5) {
    const response = await this.api.get('/recommendations/channels', {
      params: { page, pageSize },
    });
    return response.data.recommendations;
  }

  /**
   * 獲取單一頻道影片
   */
  async getChannelVideos(channelName: string, limit: number = 20): Promise<Track[]> {
    const response = await this.api.get(`/recommendations/channel/${encodeURIComponent(channelName)}`, {
      params: { limit },
    });
    return response.data.videos;
  }

  /**
   * 刷新推薦
   */
  async refreshRecommendations(): Promise<void> {
    await this.api.post('/recommendations/refresh');
  }
}

export default new ApiService();
