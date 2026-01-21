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
}

export default new ApiService();
