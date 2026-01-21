export interface YouTubeSearchResult {
  id: string;
  videoId: string;
  title: string;
  channel: string;
  duration: number; // seconds
  thumbnail: string;
  views?: number;
  uploadedAt?: string;
}

export interface YouTubeStreamInfo {
  videoId: string;
  title: string;
  duration: number;
  formats: AudioFormat[];
}

export interface AudioFormat {
  itag: number;
  mimeType: string;
  bitrate: number;
  audioQuality: string;
  url: string;
}

export interface StreamOptions {
  quality?: 'lowest' | 'highest' | 'highestaudio';
  filter?: 'audioonly' | 'videoonly' | 'audioandvideo';
}
