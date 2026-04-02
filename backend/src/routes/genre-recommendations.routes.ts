import { Router, Request, Response } from 'express';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';
import youtubeService from '../services/youtube.service';
import { getUserProfile } from '../services/style-cache.service';

const router = Router();

// TrackMetadata 已不需要 — similar route 改用 two-tier YouTube search

// RecommendationScore 已不需要 — similar route 改用 two-tier search

/**
 * Get user preference profile
 * GET /api/recommendations/profile
 */
router.get('/profile', async (_req: Request, res: Response) => {
  const profile = await getUserProfile();
  if (profile) {
    res.json({ profile });
  } else {
    res.json({ profile: null, reason: 'insufficient_data' });
  }
});

/**
 * Get recommendations based on a seed track
 * Two-tier strategy: same artist first (up to 10), then AI-recommended different artists
 * GET /api/recommendations/similar/:videoId?limit=20
 */
router.get('/similar/:videoId', async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;

    const db = getDatabase();

    // Get seed track from cached_tracks
    const seedTrack = db
      .prepare(
        `SELECT video_id, title, channel_name, genres, audio_features, tags
         FROM cached_tracks
         WHERE video_id = ?`
      )
      .get(videoId) as any;

    // 優先用 DB，fallback 用 query params（新歌可能還沒入 cached_tracks）
    const title = seedTrack?.title || (req.query.title as string) || '';
    const artist = seedTrack?.channel_name || (req.query.artist as string) || '';
    const seenIds = new Set([videoId]);
    const seenTitles = new Set<string>();
    const seedLower = title.toLowerCase().replace(/[\(\[].*/g, '').trim();
    const sameArtistMax = Math.min(10, Math.floor(limit / 2));
    const allRecommendations: any[] = [];

    // 輔助函數：去重 + 過濾
    const addTrack = (t: any, reason: string): boolean => {
      if (seenIds.has(t.videoId)) return false;
      const dur = t.duration || 0;
      if (dur <= 0 || dur > 7200) return false;
      const core = (t.title || '').toLowerCase().replace(/[\(\[].*/g, '').trim();
      if (seedLower && core === seedLower) return false;
      if (seenTitles.has(core)) return false;
      seenIds.add(t.videoId);
      seenTitles.add(core);
      allRecommendations.push({
        videoId: t.videoId, title: t.title, channelName: t.channel,
        thumbnail: t.thumbnail, duration: t.duration, score: 0.9,
        reasons: [reason],
      });
      return true;
    };

    // ===== Tier 1: 同歌手的其他歌曲（最多 sameArtistMax 首）=====
    if (artist) {
      try {
        const artistResults = await youtubeService.search(`${artist} songs`, 20);
        let sameArtistCount = 0;
        for (const t of artistResults) {
          if (sameArtistCount >= sameArtistMax) break;
          // 只取同頻道的
          const isFromSameArtist = t.channel && (
            t.channel.toLowerCase() === artist.toLowerCase() ||
            t.channel.toLowerCase().includes(artist.toLowerCase()) ||
            artist.toLowerCase().includes(t.channel.toLowerCase())
          );
          if (!isFromSameArtist) continue;
          if (addTrack(t, `Same artist: ${artist}`)) {
            sameArtistCount++;
          }
        }
        console.log(`🎤 [Similar] ${sameArtistCount} tracks from same artist "${artist}"`);
      } catch (err) {
        console.warn('⚠️ [Similar] Same artist search failed:', err);
      }
    }

    // ===== Tier 2: AI 推薦不同歌手的相似風格（填滿剩餘）=====
    const remaining = limit - allRecommendations.length;
    if (remaining > 0) {
      let queries: string[] = [];
      try {
        const { getApiKey } = await import('../services/gemini.service');
        const apiKey = getApiKey();
        if (apiKey) {
          const { GoogleGenerativeAI } = await import('@google/generative-ai');
          const genai = new GoogleGenerativeAI(apiKey);
          const model = genai.getGenerativeModel({
            model: 'gemini-2.5-flash',
            generationConfig: { maxOutputTokens: 400, temperature: 0.9 },
          });

          const result = await model.generateContent(
            `I'm listening to "${title}" by "${artist}". Suggest 8 songs by DIFFERENT artists with similar style/genre/mood. Format: one per line, "Artist - Song". No numbering, no quotes.`
          );
          queries = result.response.text().trim().split('\n')
            .map(q => q.replace(/^\d+[\.\)]\s*/, '').trim())
            .filter(q => q.length > 3 && q.length < 80);
          console.log(`🤖 [Similar] AI queries:`, queries);
        }
      } catch (aiErr) {
        console.warn('⚠️ [Similar] AI failed, fallback to search');
      }

      // Fallback queries
      if (queries.length === 0) {
        queries = [`${artist} similar artists`, `songs like ${title}`];
      }

      for (const q of queries.slice(0, 6)) {
        if (allRecommendations.length >= limit) break;
        try {
          const results = await youtubeService.search(q, 10);
          for (const t of results) {
            if (allRecommendations.length >= limit) break;
            addTrack(t, `AI: similar style to ${artist}`);
          }
        } catch { /* continue */ }
      }
    }

    // 同歌手在前，其餘隨機排序
    const sameArtist = allRecommendations.filter(r => r.reasons[0]?.startsWith('Same artist'));
    const others = allRecommendations.filter(r => !r.reasons[0]?.startsWith('Same artist'));
    // 隨機排序 others
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j], others[i]];
    }
    const recommendations = [...sameArtist, ...others].slice(0, limit);

    console.log(`🎵 [Similar] ${sameArtist.length} same artist + ${others.length} AI-curated = ${recommendations.length} total`);
    if (recommendations.length > 0) return res.json({ recommendations });

    // Fallback: 資料庫隨機推薦
    const randomTracks = db
      .prepare(
        `SELECT video_id, title, channel_name, thumbnail
         FROM cached_tracks
         WHERE video_id != ?
         ORDER BY RANDOM()
         LIMIT ?`
      )
      .all(videoId, limit) as any[];

    return res.json({
      recommendations: randomTracks.map(track => ({
        videoId: track.video_id, title: track.title,
        channelName: track.channel_name, thumbnail: track.thumbnail,
        score: 0.3, reasons: ['Random recommendation'],
      })),
    });
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

export default router;
