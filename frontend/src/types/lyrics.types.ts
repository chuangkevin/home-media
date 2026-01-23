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
}
