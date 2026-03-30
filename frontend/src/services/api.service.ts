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
      await this.api.post(`/preload/${videoId}`, {}, { timeout: 60000 });
    } catch (error) {
      // 忽略預加載錯誤，不影響主流程（靜默失敗）
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

  // ==================== 快取狀態 ====================

  /**
   * 檢查單一曲目的伺服器端快取狀態
   */
  async getCacheStatus(videoId: string): Promise<CacheStatus> {
    const response = await this.api.get<CacheStatus>(`/cache/status/${videoId}`);
    return response.data;
  }

  /**
   * 批量檢查多個曲目的伺服器端快取狀態
   */
  async getCacheStatusBatch(videoIds: string[]): Promise<Record<string, CacheStatus>> {
    const response = await this.api.post<Record<string, CacheStatus>>('/cache/status/batch', { videoIds });
    return response.data;
  }

  /**
   * 獲取伺服器端音訊快取統計資訊
   */
  async getServerCacheStats(): Promise<{ count: number; size: number } | null> {
    try {
      const response = await this.api.get<{ count: number; size: number }>('/cache/stats');
      return response.data;
    } catch (error) {
      console.warn('Failed to fetch server cache stats:', error);
      return null;
    }
  }

  /**
   * 清空所有伺服器端音訊快取
   */
  async clearServerCache(): Promise<{ success: boolean; message: string; deletedCount: number; deletedSizeMB: number }> {
    const response = await this.api.delete<{ success: boolean; message: string; deletedCount: number; deletedSizeMB: number }>('/cache/clear');
    return response.data;
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

  /**
   * 手動獲取 YouTube CC 字幕
   */
  async getYouTubeCaptions(videoId: string): Promise<Lyrics | null> {
    try {
      const response = await this.api.get<{ videoId: string; lyrics: Lyrics }>(`/lyrics/youtube-cc/${videoId}`, {
        timeout: 60000, // YouTube CC 可能需要較長時間
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
  updateLyricsPreferences(videoId: string, prefs: { timeOffset?: number; lrclibId?: number | null; neteaseId?: number | null }): void {
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
      .catch(() => {/* 靜默失敗，不影響用戶體驗 */});
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
      .catch(() => {/* 靜默失敗，不影響用戶體驗 */});
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
   * 獲取混合推薦（頻道 + 相似歌曲）
   */
  async getMixedRecommendations(page: number = 0, pageSize: number = 5, includeCount: number = 3) {
    const response = await this.api.get('/recommendations/mixed', {
      params: { page, pageSize, includeCount },
    });
    return response.data.recommendations;
  }

  /**
   * 獲取最近播放的歌曲
   */
  async getRecentlyPlayed(limit: number = 10): Promise<Track[]> {
    const response = await this.api.get('/recommendations/recently-played', {
      params: { limit },
    });
    return response.data.tracks;
  }

  /**
   * 獲取相似歌曲推薦
   */
  async getSimilarTracks(videoId: string, limit: number = 10) {
    const response = await this.api.get(`/recommendations/similar/${videoId}`, {
      params: { limit },
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

  // ==================== 播放清單 ====================

  /**
   * 獲取所有播放清單
   */
  async getPlaylists(): Promise<Playlist[]> {
    const response = await this.api.get<{ playlists: Playlist[] }>('/playlists');
    return response.data.playlists;
  }

  /**
   * 獲取單一播放清單（含曲目）
   */
  async getPlaylist(playlistId: string): Promise<PlaylistWithTracks | null> {
    try {
      const response = await this.api.get<PlaylistWithTracks>(`/playlists/${playlistId}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * 建立播放清單
   */
  async createPlaylist(name: string, description?: string): Promise<Playlist> {
    const response = await this.api.post<Playlist>('/playlists', { name, description });
    return response.data;
  }

  /**
   * 更新播放清單資訊
   */
  async updatePlaylist(playlistId: string, name?: string, description?: string): Promise<void> {
    await this.api.put(`/playlists/${playlistId}`, { name, description });
  }

  /**
   * 刪除播放清單
   */
  async deletePlaylist(playlistId: string): Promise<void> {
    await this.api.delete(`/playlists/${playlistId}`);
  }

  /**
   * 新增曲目到播放清單
   */
  async addTrackToPlaylist(playlistId: string, track: Track): Promise<void> {
    await this.api.post(`/playlists/${playlistId}/tracks`, { track });
  }

  /**
   * 批量新增曲目到播放清單
   */
  async addTracksToPlaylist(playlistId: string, tracks: Track[]): Promise<number> {
    const response = await this.api.post<{ success: boolean; added: number }>(`/playlists/${playlistId}/tracks/batch`, { tracks });
    return response.data.added;
  }

  /**
   * 從播放清單移除曲目
   */
  async removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void> {
    await this.api.delete(`/playlists/${playlistId}/tracks/${trackId}`);
  }

  /**
   * 移動曲目位置
   */
  async moveTrackInPlaylist(playlistId: string, trackId: string, position: number): Promise<void> {
    await this.api.put(`/playlists/${playlistId}/tracks/${trackId}/move`, { position });
  }

  /**
   * 清空播放清單
   */
  async clearPlaylist(playlistId: string): Promise<number> {
    const response = await this.api.delete<{ success: boolean; removed: number }>(`/playlists/${playlistId}/tracks`);
    return response.data.removed;
  }

  /**
   * 隱藏頻道
   */
  async hideChannel(channelName: string): Promise<void> {
    await this.api.post('/hidden-channels', { channelName });
  }

  /**
   * 取得被隱藏的頻道列表
   */
  async getHiddenChannels(): Promise<string[]> {
    const response = await this.api.get<string[]>('/hidden-channels');
    return response.data;
  }

  /**
   * 取消隱藏頻道
   */
  async unhideChannel(channelName: string): Promise<void> {
    await this.api.delete(`/hidden-channels/${encodeURIComponent(channelName)}`);
  }

  // ==================== 系統設定 ====================

  /**
   * 獲取所有設定
   */
  async getSettings(): Promise<any> {
    const response = await this.api.get('/settings');
    return response.data;
  }

  /**
   * 獲取單一設定
   */
  async getSetting(key: string): Promise<any> {
    const response = await this.api.get(`/settings/${key}`);
    return response.data[key];
  }

  /**
   * 更新設定
   */
  async updateSettings(settings: Record<string, any>): Promise<void> {
    await this.api.post('/settings/batch', { settings });
  }

  /**
   * 更新單一設定
   */
  async updateSetting(key: string, value: any): Promise<void> {
    await this.api.put(`/settings/${key}`, { value });
  }

  // Gemini API Key 管理
  async getGeminiStatus(): Promise<{ configured: boolean; keys: Array<{ suffix: string; fromEnv: boolean }> }> {
    const res = await this.api.get('/gemini/status');
    return res.data;
  }

  async addGeminiKeys(keys: string): Promise<{ added: number; skipped: number; total: number }> {
    const res = await this.api.post('/gemini/keys', { keys });
    return res.data;
  }

  async removeGeminiKey(suffix: string): Promise<void> {
    await this.api.delete(`/gemini/keys/${suffix}`);
  }

  // ==================== 播放信號追蹤 ====================

  async recordSkip(videoId: string): Promise<void> {
    await this.api.post(`/tracks/${videoId}/signal`, { type: 'skip' });
  }

  async recordComplete(videoId: string): Promise<void> {
    await this.api.post(`/tracks/${videoId}/signal`, { type: 'complete' });
  }

  // ==================== 風格分析 ====================

  async analyzeTrackStyle(videoId: string, title: string, channel?: string, tags?: string[]): Promise<any> {
    const res = await this.api.post(`/tracks/${videoId}/style`, { title, channel, tags });
    return res.data;
  }

  async getTrackStyle(videoId: string): Promise<any> {
    try {
      const res = await this.api.get(`/tracks/${videoId}/style`);
      return res.data?.style || null;
    } catch {
      return null;
    }
  }

  // ==================== 影片快取 ====================

  async downloadVideo(videoId: string): Promise<void> {
    await this.api.post(`/video-cache/${videoId}/download`);
  }

  async getVideoCacheStatus(videoId: string): Promise<{ cached: boolean; downloading: boolean }> {
    const res = await this.api.get(`/video-cache/${videoId}/status`);
    return res.data;
  }

  getVideoCacheStreamUrl(videoId: string): string {
    return `${this.api.defaults.baseURL}/video-cache/${videoId}/stream`;
  }

  async deleteVideoCache(videoId: string): Promise<void> {
    await this.api.delete(`/video-cache/${videoId}`);
  }

  async videoCacheCleanup(): Promise<void> {
    await this.api.post('/video-cache/cleanup');
  }

  // ==================== SponsorBlock ====================

  // ==================== 播放（高優先級下載）====================

  private playAbortController: AbortController | null = null;

  async requestPlay(videoId: string): Promise<{ status: string; cached?: boolean; url?: string | null }> {
    // 取消之前的 play 請求
    this.cancelPlay();
    this.playAbortController = new AbortController();

    const response = await this.api.post(`/play/${videoId}`, {}, {
      timeout: 120000,
      signal: this.playAbortController.signal,
    });
    return response.data;
  }

  cancelPlay(): void {
    if (this.playAbortController) {
      this.playAbortController.abort();
      this.playAbortController = null;
    }
  }

  async generateAILyrics(videoId: string): Promise<any> {
    const res = await this.api.post(`/tracks/${videoId}/ai-lyrics`, {}, { timeout: 120000 });
    return res.data;
  }

  async deleteAILyricsCache(videoId: string): Promise<void> {
    await this.api.delete(`/tracks/${videoId}/ai-lyrics`);
  }

  async translateLyrics(videoId: string, lines: string[]): Promise<{ translations: string[]; detected_language: string } | null> {
    try {
      const res = await this.api.post(`/tracks/${videoId}/translate`, { lines }, { timeout: 60000 });
      return res.data;
    } catch {
      return null;
    }
  }

  async getSponsorBlockSegments(videoId: string): Promise<Array<{ start: number; end: number; category: string }>> {
    try {
      const res = await this.api.get(`/sponsorblock/${videoId}`, { timeout: 8000 });
      return res.data?.segments || [];
    } catch {
      return [];
    }
  }
}

// 播放清單型別
export interface Playlist {
  id: string;
  name: string;
  description?: string;
  trackCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistWithTracks extends Playlist {
  tracks: Track[];
}

// 快取狀態
export interface CacheStatus {
  videoId: string;
  cached: boolean;
  downloading: boolean;
  progress: {
    videoId: string;
    downloadedBytes: number;
    totalBytes: number | null;
    percentage: number;
    status: 'downloading' | 'completed' | 'failed';
    startedAt: number;
  } | null;
}

export default new ApiService();
