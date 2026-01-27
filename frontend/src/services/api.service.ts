import axios from 'axios';
import type { Track, SearchResponse } from '../types/track.types';
import type { Lyrics, LyricsSearchResult, LyricsSource, LyricsPreferences } from '../types/lyrics.types';

// 所有 API 請求都通過 nginx 代理 (/api)
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

class ApiService {
  private api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
  });

  // 用於取消過時的歌詞請求
  private lyricsAbortController: AbortController | null = null;
  private searchLyricsAbortController: AbortController | null = null;

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
   * 獲取歌詞（支援取消過時請求）
   */
  async getLyrics(videoId: string, title: string, artist?: string): Promise<Lyrics | null> {
    // 取消之前的歌詞請求（避免請求堆積）
    if (this.lyricsAbortController) {
      this.lyricsAbortController.abort();
    }
    this.lyricsAbortController = new AbortController();

    try {
      const response = await this.api.get<{ videoId: string; lyrics: Lyrics }>(`/lyrics/${videoId}`, {
        params: { title, artist },
        timeout: 90000, // 歌詞獲取需要較長時間（嘗試多個來源：YouTube CC、網易雲、LRCLIB、Genius）
        signal: this.lyricsAbortController.signal,
      });
      return response.data.lyrics;
    } catch (error) {
      // 被取消的請求不需要報錯
      if (axios.isCancel(error)) {
        console.log(`🎵 歌詞請求已取消: ${videoId}`);
        return null;
      }
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // 找不到歌詞，返回 null
        return null;
      }
      throw error;
    }
  }

  /**
   * 搜尋歌詞（支援多平台：lrclib, netease）
   */
  async searchLyrics(query: string, source: LyricsSource = 'lrclib'): Promise<LyricsSearchResult[]> {
    // 取消之前的搜尋請求
    if (this.searchLyricsAbortController) {
      this.searchLyricsAbortController.abort();
    }
    this.searchLyricsAbortController = new AbortController();

    try {
      const endpoint = source === 'netease' ? '/lyrics/search/netease' : '/lyrics/search';
      const response = await this.api.get<{ query: string; count: number; results: LyricsSearchResult[] }>(endpoint, {
        params: { q: query },
        timeout: 60000,
        signal: this.searchLyricsAbortController.signal,
      });
      return response.data.results;
    } catch (error) {
      if (axios.isCancel(error)) {
        console.log(`🎵 歌詞搜尋已取消: ${query}`);
        return [];
      }
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
        timeout: 45000,
      });
      return response.data.lyrics;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * 透過網易雲音樂 ID 獲取特定歌詞
   */
  async getLyricsByNeteaseId(videoId: string, neteaseId: number): Promise<Lyrics | null> {
    try {
      const response = await this.api.get<{ videoId: string; lyrics: Lyrics }>(`/lyrics/netease/${neteaseId}`, {
        params: { videoId },
        timeout: 45000,
      });
      return response.data.lyrics;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  // ==================== 歌詞偏好（跨裝置同步）====================

  /**
   * 獲取歌詞偏好設定（時間偏移、選擇的歌詞版本）
   */
  async getLyricsPreferences(videoId: string): Promise<LyricsPreferences | null> {
    try {
      const response = await this.api.get<LyricsPreferences>(`/lyrics/preferences/${videoId}`, {
        timeout: 5000,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      console.warn('getLyricsPreferences failed:', error);
      return null;
    }
  }

  /**
   * 更新歌詞偏好設定（fire-and-forget，不阻塞主流程）
   */
  updateLyricsPreferences(videoId: string, prefs: { timeOffset?: number; lrclibId?: number | null }): void {
    this.api.put(`/lyrics/preferences/${videoId}`, prefs, { timeout: 5000 })
      .catch(err => console.warn('updateLyricsPreferences failed:', err.message));
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
   * 記錄搜尋（fire-and-forget，不阻塞主流程）
   */
  recordSearch(query: string, resultCount: number): void {
    this.api.post('/history/search', { query, resultCount }, { timeout: 5000 })
      .catch(err => console.warn('recordSearch failed:', err.message));
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
   * 記錄頻道觀看（fire-and-forget，不阻塞主流程）
   */
  recordChannelWatch(channelName: string, channelThumbnail: string = ''): void {
    // 使用較短的 timeout 並忽略錯誤，避免影響播放體驗
    this.api.post('/history/channel', { channelName, channelThumbnail }, { timeout: 5000 })
      .catch(err => console.warn('recordChannelWatch failed:', err.message));
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
