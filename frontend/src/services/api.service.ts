import axios from 'axios';
import type { Track, SearchResponse } from '../types/track.types';

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
   * 注意：直接使用後端 URL，不通過 Vite proxy，以支援重定向
   */
  getStreamUrl(videoId: string, quality: string = 'highestaudio'): string {
    const backendUrl = 'http://localhost:3001';
    return `${backendUrl}/api/stream/${videoId}?quality=${quality}`;
  }

  /**
   * 預加載音訊 URL（觸發後端緩存，立即返回）
   */
  async preloadAudio(videoId: string): Promise<void> {
    try {
      const backendUrl = 'http://localhost:3001';
      await axios.post(`${backendUrl}/api/preload/${videoId}`, {}, { timeout: 30000 });
    } catch (error) {
      // 忽略預加載錯誤，不影響主流程
      console.warn(`Preload failed for ${videoId}:`, error);
    }
  }

  /**
   * 預加載音訊 URL（等待完成，用於第一首）
   */
  async preloadAudioWait(videoId: string): Promise<void> {
    const backendUrl = 'http://localhost:3001';
    await axios.post(`${backendUrl}/api/preload-wait/${videoId}`, {}, { timeout: 60000 });
  }

  /**
   * 批量預加載音訊
   */
  async preloadMultiple(videoIds: string[]): Promise<void> {
    await Promise.all(videoIds.map(id => this.preloadAudio(id)));
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
