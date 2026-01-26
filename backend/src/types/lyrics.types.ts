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

export interface CachedLyrics {
  videoId: string;
  lyrics: string; // JSON 字串化的 Lyrics
  source: string;
  isSynced: number; // SQLite 使用 0/1
  cachedAt: number;
}
