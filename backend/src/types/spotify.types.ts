export interface SpotifyTrack {
  id: string;
  name: string;
  artists: string[];
  genres: string[];
  audioFeatures?: SpotifyAudioFeatures;
  popularity?: number;
}

export interface SpotifyAudioFeatures {
  danceability: number;      // 0.0 - 1.0
  energy: number;            // 0.0 - 1.0
  key: number;               // 0 - 11 (C, C#, D, ...)
  loudness: number;          // dB
  mode: number;              // 0 = minor, 1 = major
  speechiness: number;       // 0.0 - 1.0
  acousticness: number;      // 0.0 - 1.0
  instrumentalness: number;  // 0.0 - 1.0
  liveness: number;          // 0.0 - 1.0
  valence: number;           // 0.0 - 1.0 (happiness)
  tempo: number;             // BPM
  duration_ms: number;
  time_signature: number;
}

export interface SpotifySearchResult {
  spotifyId: string;
  name: string;
  artists: string[];
  matchScore: number; // 0-1, how well it matches the YouTube track
}
