export interface Track {
  id: string;
  videoId: string;
  title: string;
  channel: string;
  duration: number;
  thumbnail: string;
  views?: number;
  uploadedAt?: string;
}

export interface SearchResponse {
  query: string;
  count: number;
  results: Track[];
}
