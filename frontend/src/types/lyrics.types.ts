export interface LyricsLine {
  time: number; // 時間戳（秒）
  text: string; // 歌詞文字
}

export interface Lyrics {
  videoId: string;
  lines: LyricsLine[];
  source: 'youtube' | 'genius' | 'lrclib' | 'musixmatch' | 'manual';
  isSynced: boolean; // 是否有時間戳
  language?: string;
  lrclibId?: number; // 使用者選擇的 LRCLIB 歌詞 ID
  timeOffset?: number; // 使用者設定的時間偏移（秒）
}

// LRCLIB 搜尋結果
export interface LRCLIBSearchResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  hasSyncedLyrics: boolean;
}
