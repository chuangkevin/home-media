import axios from 'axios';
import logger from '../utils/logger';
import { SpotifyTrack, SpotifyAudioFeatures, SpotifySearchResult } from '../types/spotify.types';

class SpotifyService {
  private clientId: string | null = null;
  private clientSecret: string | null = null;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID || null;
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET || null;

    if (!this.clientId || !this.clientSecret) {
      logger.warn('⚠️ Spotify API credentials not configured. Recommendation features will be limited.');
      logger.info('💡 To enable Spotify integration:');
      logger.info('   1. Go to https://developer.spotify.com/dashboard');
      logger.info('   2. Create an app and get Client ID & Secret');
      logger.info('   3. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env');
    }
  }

  /**
   * Check if Spotify API is configured
   */
  isConfigured(): boolean {
    return this.clientId !== null && this.clientSecret !== null;
  }

  /**
   * Get Spotify access token (Client Credentials Flow)
   */
  private async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Spotify API not configured');
    }

    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken as string;
    }

    try {
      const response = await axios.post(
        'https://accounts.spotify.com/api/token',
        'grant_type=client_credentials',
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
          },
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + response.data.expires_in * 1000 - 60000; // 1 min buffer

      logger.info('✅ Spotify access token obtained');
      return this.accessToken as string;
    } catch (error) {
      logger.error('Failed to get Spotify access token:', error);
      throw new Error('Failed to authenticate with Spotify');
    }
  }

  /**
   * Search for a track on Spotify
   * @param title - Track title from YouTube
   * @param artist - Artist/channel name from YouTube
   * @returns Best matching Spotify track or null
   */
  async searchTrack(title: string, artist?: string): Promise<SpotifySearchResult | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const token = await this.getAccessToken();

      // Clean up title - remove common YouTube suffixes
      const cleanTitle = title
        .replace(/\(Official.*\)/gi, '')
        .replace(/\[Official.*\]/gi, '')
        .replace(/- Official.*/gi, '')
        .replace(/\(Lyric.*\)/gi, '')
        .replace(/\[Lyric.*\]/gi, '')
        .replace(/\(Audio\)/gi, '')
        .replace(/\[Audio\]/gi, '')
        .replace(/\(MV\)/gi, '')
        .replace(/\[MV\]/gi, '')
        .replace(/\(.*Video.*\)/gi, '')
        .replace(/\[.*Video.*\]/gi, '')
        .trim();

      // Build search query
      let query = cleanTitle;
      if (artist) {
        const cleanArtist = artist.replace(/ - Topic$/i, '').replace(/VEVO$/i, '').trim();
        query = `track:${cleanTitle} artist:${cleanArtist}`;
      }

      const response = await axios.get('https://api.spotify.com/v1/search', {
        params: {
          q: query,
          type: 'track',
          limit: 5,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const tracks = response.data.tracks.items;
      if (tracks.length === 0) {
        return null;
      }

      // Calculate match scores and return best match
      const matches: SpotifySearchResult[] = tracks.map((track: any) => ({
        spotifyId: track.id,
        name: track.name,
        artists: track.artists.map((a: any) => a.name),
        matchScore: this.calculateMatchScore(cleanTitle, artist, track.name, track.artists[0]?.name),
      }));

      // Sort by match score
      matches.sort((a, b) => b.matchScore - a.matchScore);

      // Return best match if score is reasonable
      if (matches[0].matchScore > 0.5) {
        logger.info(`✅ Spotify match found for "${title}": ${matches[0].name} (score: ${matches[0].matchScore.toFixed(2)})`);
        return matches[0];
      }

      logger.debug(`⚠️ No good Spotify match for "${title}" (best score: ${matches[0].matchScore.toFixed(2)})`);
      return null;
    } catch (error) {
      logger.error(`Failed to search Spotify for "${title}":`, error);
      return null;
    }
  }

  /**
   * Get audio features for a Spotify track
   */
  async getAudioFeatures(spotifyId: string): Promise<SpotifyAudioFeatures | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const token = await this.getAccessToken();

      const response = await axios.get(`https://api.spotify.com/v1/audio-features/${spotifyId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data;
    } catch (error) {
      logger.error(`Failed to get audio features for ${spotifyId}:`, error);
      return null;
    }
  }

  /**
   * Get track details including genres
   */
  async getTrackDetails(spotifyId: string): Promise<SpotifyTrack | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const token = await this.getAccessToken();

      const [trackRes, featuresRes] = await Promise.all([
        axios.get(`https://api.spotify.com/v1/tracks/${spotifyId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        this.getAudioFeatures(spotifyId),
      ]);

      const track = trackRes.data;

      // Get artist details for genres
      const artistId = track.artists[0]?.id;
      let genres: string[] = [];

      if (artistId) {
        const artistRes = await axios.get(`https://api.spotify.com/v1/artists/${artistId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        genres = artistRes.data.genres || [];
      }

      return {
        id: track.id,
        name: track.name,
        artists: track.artists.map((a: any) => a.name),
        genres,
        audioFeatures: featuresRes || undefined,
        popularity: track.popularity,
      };
    } catch (error) {
      logger.error(`Failed to get track details for ${spotifyId}:`, error);
      return null;
    }
  }

  /**
   * Calculate match score between YouTube and Spotify track
   * @returns Score from 0 to 1
   */
  private calculateMatchScore(ytTitle: string, ytArtist: string | undefined, spTitle: string, spArtist: string): number {
    // Normalize strings for comparison
    const normalize = (str: string) =>
      str
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const normYtTitle = normalize(ytTitle);
    const normSpTitle = normalize(spTitle);
    const normYtArtist = ytArtist ? normalize(ytArtist) : '';
    const normSpArtist = normalize(spArtist);

    // Calculate title similarity (Levenshtein-like)
    const titleScore = this.stringSimilarity(normYtTitle, normSpTitle);

    // Calculate artist similarity
    let artistScore = 0.5; // default if no YouTube artist
    if (ytArtist) {
      artistScore = this.stringSimilarity(normYtArtist, normSpArtist);
    }

    // Weighted average (title more important)
    return titleScore * 0.7 + artistScore * 0.3;
  }

  /**
   * Simple string similarity using longest common substring
   */
  private stringSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1;
    if (str1.length === 0 || str2.length === 0) return 0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.includes(shorter)) {
      return shorter.length / longer.length;
    }

    const lcs = this.longestCommonSubstring(str1, str2);
    return (lcs.length * 2) / (str1.length + str2.length);
  }

  /**
   * Find longest common substring
   */
  private longestCommonSubstring(str1: string, str2: string): string {
    const matrix: number[][] = Array(str2.length + 1)
      .fill(null)
      .map(() => Array(str1.length + 1).fill(0));

    let maxLength = 0;
    let endIndex = 0;

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2[i - 1] === str1[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1] + 1;
          if (matrix[i][j] > maxLength) {
            maxLength = matrix[i][j];
            endIndex = j;
          }
        }
      }
    }

    return str1.substring(endIndex - maxLength, endIndex);
  }
}

export default new SpotifyService();
