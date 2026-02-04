import { Router, Request, Response } from 'express';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';
import { SpotifyAudioFeatures } from '../types/spotify.types';

const router = Router();

interface TrackMetadata {
  videoId: string;
  title: string;
  channelName: string;
  genres: string[];
  audioFeatures: SpotifyAudioFeatures | null;
  tags: string[];
}

interface RecommendationScore {
  videoId: string;
  title: string;
  channelName: string;
  thumbnail: string;
  score: number;
  reasons: string[];
}

/**
 * Get recommendations based on a seed track (using genres and audio features)
 * GET /api/recommendations/similar/:videoId
 */
router.get('/similar/:videoId', async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;

    const db = getDatabase();

    // Get seed track
    const seedTrack = db
      .prepare(
        `SELECT video_id, title, channel_name, genres, audio_features, tags
         FROM cached_tracks
         WHERE video_id = ?`
      )
      .get(videoId) as any;

    if (!seedTrack) {
      return res.status(404).json({ error: 'Track not found' });
    }

    const seed: TrackMetadata = {
      videoId: seedTrack.video_id,
      title: seedTrack.title,
      channelName: seedTrack.channel_name,
      genres: seedTrack.genres ? JSON.parse(seedTrack.genres) : [],
      audioFeatures: seedTrack.audio_features ? JSON.parse(seedTrack.audio_features) : null,
      tags: seedTrack.tags ? JSON.parse(seedTrack.tags) : [],
    };

    // Get candidates (tracks with metadata, excluding seed)
    const candidates = db
      .prepare(
        `SELECT video_id, title, channel_name, thumbnail, genres, audio_features, tags
         FROM cached_tracks
         WHERE video_id != ?
         LIMIT 200`
      )
      .all(videoId) as any[];

    if (candidates.length === 0) {
      return res.json({ recommendations: [], message: 'No tracks available for recommendations' });
    }

    // Calculate similarity scores
    const scores: RecommendationScore[] = candidates.map((candidate) => {
      const candidateMetadata: TrackMetadata = {
        videoId: candidate.video_id,
        title: candidate.title,
        channelName: candidate.channel_name,
        genres: candidate.genres ? JSON.parse(candidate.genres) : [],
        audioFeatures: candidate.audio_features ? JSON.parse(candidate.audio_features) : null,
        tags: candidate.tags ? JSON.parse(candidate.tags) : [],
      };

      const { score, reasons } = calculateSimilarity(seed, candidateMetadata);

      return {
        videoId: candidate.video_id,
        title: candidate.title,
        channelName: candidate.channel_name,
        thumbnail: candidate.thumbnail,
        score,
        reasons,
      };
    });

    // Sort by score and return top N
    scores.sort((a, b) => b.score - a.score);
    const recommendations = scores.slice(0, limit);

    logger.info(`Generated ${recommendations.length} recommendations for ${videoId}`);

    return res.json({ recommendations });
  } catch (error) {
    logger.error('Error generating recommendations:', error);
    return res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});

/**
 * Get tracks by genre
 * GET /api/recommendations/genre/:genre
 */
router.get('/genre/:genre', async (req: Request, res: Response) => {
  try {
    const { genre } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;

    const db = getDatabase();

    const tracks = db
      .prepare(
        `SELECT video_id, title, channel_name, thumbnail, genres
         FROM cached_tracks
         WHERE genres IS NOT NULL
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit * 2) as any[];

    // Filter tracks containing the genre
    const filtered = tracks
      .filter((track) => {
        const genres: string[] = track.genres ? JSON.parse(track.genres) : [];
        return genres.some((g) => g.toLowerCase().includes(genre.toLowerCase()));
      })
      .slice(0, limit);

    const results = filtered.map((track) => ({
      videoId: track.video_id,
      title: track.title,
      channelName: track.channel_name,
      thumbnail: track.thumbnail,
      genres: track.genres ? JSON.parse(track.genres) : [],
    }));

    res.json({ genre, tracks: results, count: results.length });
  } catch (error) {
    logger.error('Error fetching tracks by genre:', error);
    res.status(500).json({ error: 'Failed to fetch tracks by genre' });
  }
});

/**
 * Get all available genres
 * GET /api/recommendations/genres
 */
router.get('/genres', async (_req: Request, res: Response) => {
  try {
    const db = getDatabase();

    const tracks = db
      .prepare(
        `SELECT genres
         FROM cached_tracks
         WHERE genres IS NOT NULL`
      )
      .all() as any[];

    const genreCount = new Map<string, number>();

    tracks.forEach((track) => {
      const genres: string[] = JSON.parse(track.genres);
      genres.forEach((genre) => {
        genreCount.set(genre, (genreCount.get(genre) || 0) + 1);
      });
    });

    const genreList = Array.from(genreCount.entries())
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ genres: genreList, total: genreList.length });
  } catch (error) {
    logger.error('Error fetching genres:', error);
    res.status(500).json({ error: 'Failed to fetch genres' });
  }
});

/**
 * Calculate similarity between seed and candidate track
 * Adaptive weights: uses Spotify data if available, otherwise relies on YouTube metadata
 */
function calculateSimilarity(
  seed: TrackMetadata,
  candidate: TrackMetadata
): { score: number; reasons: string[] } {
  let totalScore = 0;
  const reasons: string[] = [];

  // Check if Spotify data is available
  const hasSpotifyData = seed.genres.length > 0 || seed.audioFeatures !== null;

  if (hasSpotifyData) {
    // === WITH SPOTIFY DATA ===
    
    // 1. Genre similarity (40% weight)
    if (seed.genres.length > 0 && candidate.genres.length > 0) {
      const genreScore = calculateGenreScore(seed.genres, candidate.genres);
      totalScore += genreScore * 0.4;
      if (genreScore > 0.5) {
        const commonGenres = seed.genres.filter((g) => candidate.genres.includes(g));
        reasons.push(`共同曲風: ${commonGenres.join(', ')}`);
      }
    }

    // 2. Audio features similarity (30% weight)
    if (seed.audioFeatures && candidate.audioFeatures) {
      const audioScore = calculateAudioFeaturesScore(seed.audioFeatures, candidate.audioFeatures);
      totalScore += audioScore * 0.3;
      if (audioScore > 0.7) {
        reasons.push('音樂特徵相似');
      }
    }

    // 3. Tag similarity (20% weight)
    if (seed.tags.length > 0 && candidate.tags.length > 0) {
      const tagScore = calculateTagScore(seed.tags, candidate.tags);
      totalScore += tagScore * 0.2;
      if (tagScore > 0.4) {
        const commonTags = seed.tags.filter((t) => candidate.tags.includes(t));
        if (commonTags.length > 0) {
          reasons.push(`共同標籤: ${commonTags.slice(0, 3).join(', ')}`);
        }
      }
    }

    // 4. Same channel (10% weight)
    if (seed.channelName === candidate.channelName) {
      totalScore += 0.1;
      reasons.push(`同一頻道: ${seed.channelName}`);
    }
  } else {
    // === WITHOUT SPOTIFY DATA (YouTube-only) ===
    
    // 1. Tag similarity (50% weight) - most important for YouTube-only
    if (seed.tags.length > 0 && candidate.tags.length > 0) {
      const tagScore = calculateTagScore(seed.tags, candidate.tags);
      totalScore += tagScore * 0.5;
      if (tagScore > 0.3) {
        const commonTags = seed.tags.filter((t) => candidate.tags.includes(t));
        if (commonTags.length > 0) {
          reasons.push(`共同標籤: ${commonTags.slice(0, 3).join(', ')}`);
        }
      }
    }

    // 2. Same channel (30% weight) - strong indicator without Spotify
    if (seed.channelName === candidate.channelName) {
      totalScore += 0.3;
      reasons.push(`同一頻道: ${seed.channelName}`);
    }

    // 3. Title similarity (20% weight) - basic text matching
    const titleScore = calculateTitleSimilarity(seed.title, candidate.title);
    if (titleScore > 0.3) {
      totalScore += titleScore * 0.2;
      if (titleScore > 0.5) {
        reasons.push('標題相似');
      }
    }
  }

  return {
    score: Math.min(totalScore, 1.0),
    reasons: reasons.length > 0 ? reasons : ['一般相似度'],
  };
}

/**
 * Calculate title similarity using word overlap
 */
function calculateTitleSimilarity(title1: string, title2: string): number {
  const normalize = (str: string) =>
    str
      .toLowerCase()
      .replace(/[^a-z0-9\s\u4e00-\u9fa5]/g, '') // Keep alphanumeric + Chinese
      .replace(/\s+/g, ' ')
      .trim();

  const words1 = new Set(normalize(title1).split(' ').filter((w) => w.length > 2));
  const words2 = new Set(normalize(title2).split(' ').filter((w) => w.length > 2));

  if (words1.size === 0 || words2.size === 0) return 0;

  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

function calculateGenreScore(genres1: string[], genres2: string[]): number {
  const set1 = new Set(genres1.map((g) => g.toLowerCase()));
  const set2 = new Set(genres2.map((g) => g.toLowerCase()));
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

function calculateAudioFeaturesScore(
  features1: SpotifyAudioFeatures,
  features2: SpotifyAudioFeatures
): number {
  const weights = {
    danceability: 0.2,
    energy: 0.2,
    valence: 0.15,
    acousticness: 0.15,
    instrumentalness: 0.1,
    tempo: 0.1,
    speechiness: 0.1,
  };

  let totalDiff = 0;

  const normTempo1 = (features1.tempo - 50) / 150;
  const normTempo2 = (features2.tempo - 50) / 150;
  totalDiff += Math.abs(normTempo1 - normTempo2) * weights.tempo;

  totalDiff += Math.abs(features1.danceability - features2.danceability) * weights.danceability;
  totalDiff += Math.abs(features1.energy - features2.energy) * weights.energy;
  totalDiff += Math.abs(features1.valence - features2.valence) * weights.valence;
  totalDiff += Math.abs(features1.acousticness - features2.acousticness) * weights.acousticness;
  totalDiff += Math.abs(features1.instrumentalness - features2.instrumentalness) * weights.instrumentalness;
  totalDiff += Math.abs(features1.speechiness - features2.speechiness) * weights.speechiness;

  return 1 - totalDiff;
}

function calculateTagScore(tags1: string[], tags2: string[]): number {
  const set1 = new Set(tags1.map((t) => t.toLowerCase()));
  const set2 = new Set(tags2.map((t) => t.toLowerCase()));
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

export default router;
