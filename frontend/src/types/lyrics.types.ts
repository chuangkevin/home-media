export interface LyricsLine {
  time: number; // 時間戳（秒）
  text: string; // 歌詞文字
}

export interface Lyrics {
  videoId: string;
  lines: LyricsLine[];
  source: 'youtube' | 'genius' | 'lrclib' | 'musixmatch' | 'netease' | 'manual';
  isSynced: boolean; // 是否有時間戳
  language?: string;
  lrclibId?: number; // 使用者選擇的 LRCLIB 歌詞 ID
  timeOffset?: number; // 使用者設定的時間偏移（秒）
}

// 歌詞搜尋結果（通用格式，適用於 LRCLIB 和 NetEase）
export interface LyricsSearchResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  hasSyncedLyrics: boolean;
}

// 為了向後相容，保留 LRCLIB 別名
export type LRCLIBSearchResult = LyricsSearchResult;

// 歌詞來源類型
export type LyricsSource = 'lrclib' | 'netease';
