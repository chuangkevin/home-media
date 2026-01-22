import { YouTubeSearchResult } from './youtube.types';

/**
 * 搜尋歷史項目
 */
export interface SearchHistoryItem {
  id: string;
  query: string;
  searchCount: number;
  lastSearchedAt: number;
  firstSearchedAt: number;
  resultCount: number;
}

/**
 * 觀看頻道資訊
 */
export interface WatchedChannel {
  id: string;
  channelId: string;
  channelName: string;
  channelThumbnail: string;
  watchCount: number;
  lastWatchedAt: number;
  firstWatchedAt: number;
}

/**
 * 頻道推薦（包含頻道資訊和影片列表）
 */
export interface ChannelRecommendation {
  channelName: string;
  channelThumbnail: string;
  videos: YouTubeSearchResult[];
  watchCount: number;
}

/**
 * 頻道影片快取項目
 */
export interface ChannelVideoCache {
  channelName: string;
  videoId: string;
  title: string;
  thumbnail: string;
  duration: number;
  views?: number;
  uploadedAt?: string;
  cachedAt: number;
}

/**
 * 推薦快取項目
 */
export interface RecommendationCache {
  id: string;
  channelName: string;
  videosJson: string;
  cachedAt: number;
  expiresAt: number;
}
