declare module 'genius-lyrics-api' {
  export interface SongOptions {
    apiKey: string;
    title: string;
    artist: string;
    optimizeQuery?: boolean;
  }

  export interface Song {
    id: number;
    title: string;
    url: string;
    lyrics: string;
    albumArt: string;
  }

  export function getSong(options: SongOptions): Promise<Song | null>;
}
