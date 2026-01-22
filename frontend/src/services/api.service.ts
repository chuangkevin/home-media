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
}

export default new ApiService();
