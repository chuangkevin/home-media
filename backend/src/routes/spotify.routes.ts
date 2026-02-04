import { Router, Request, Response } from 'express';
import spotifyService from '../services/spotify.service';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';

const router = Router();

/**
 * Check if Spotify integration is configured
 * GET /api/spotify/status
 */
router.get('/spotify/status', (_req: Request, res: Response) => {
  const isConfigured = spotifyService.isConfigured();
  res.json({
    configured: isConfigured,
    message: isConfigured
      ? 'Spotify API is configured and ready'
      : 'Spotify API credentials not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env',
  });
});

/**
 * Enrich a track with Spotify metadata
 * POST /api/spotify/enrich/:videoId
 */
router.post('/spotify/enrich/:videoId', async (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;

    if (!spotifyService.isConfigured()) {
      return res.status(503).json({
        error: 'Spotify API not configured',
        message: 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env',
      });
    }

    const db = getDatabase();

    // Get track from database
    const track = db
      .prepare(
        `SELECT video_id, title, channel_name, spotify_id 
         FROM cached_tracks 
         WHERE video_id = ?`
      )
      .get(videoId) as any;

    if (!track) {
      return res.status(404).json({ error: 'Track not found in database' });
    }

    // Skip if already enriched
    if (track.spotify_id) {
      const trackDetails = db
        .prepare(
          `SELECT genres, audio_features 
           FROM cached_tracks 
           WHERE video_id = ?`
        )
        .get(videoId) as any;

      return res.json({
        message: 'Track already enriched',
        spotifyId: track.spotify_id,
        genres: trackDetails.genres ? JSON.parse(trackDetails.genres) : [],
        audioFeatures: trackDetails.audio_features ? JSON.parse(trackDetails.audio_features) : null,
      });
    }

    // Search for track on Spotify
    const searchResult = await spotifyService.searchTrack(track.title, track.channel_name);

    if (!searchResult) {
      return res.json({
        message: 'No matching track found on Spotify',
        videoId,
        title: track.title,
      });
    }

    // Get full track details with genres and audio features
    const spotifyTrack = await spotifyService.getTrackDetails(searchResult.spotifyId);

    if (!spotifyTrack) {
      return res.status(500).json({ error: 'Failed to fetch track details from Spotify' });
    }

    // Update database with Spotify data
    db.prepare(
      `UPDATE cached_tracks 
       SET spotify_id = ?, 
           genres = ?, 
           audio_features = ?
       WHERE video_id = ?`
    ).run(
      spotifyTrack.id,
      JSON.stringify(spotifyTrack.genres),
      spotifyTrack.audioFeatures ? JSON.stringify(spotifyTrack.audioFeatures) : null,
      videoId
    );

    logger.info(`✅ Enriched track ${videoId} with Spotify data (${searchResult.matchScore.toFixed(2)} match)`);

    return res.json({
      message: 'Track enriched successfully',
      videoId,
      spotifyId: spotifyTrack.id,
      matchScore: searchResult.matchScore,
      genres: spotifyTrack.genres,
      audioFeatures: spotifyTrack.audioFeatures,
    });
  } catch (error) {
    logger.error('Error enriching track with Spotify:', error);
    return res.status(500).json({ error: 'Failed to enrich track with Spotify metadata' });
  }
});

/**
 * Batch enrich multiple tracks
 * POST /api/spotify/enrich-batch
 * Body: { videoIds: string[] }
 */
router.post('/spotify/enrich-batch', async (req: Request, res: Response) => {
  try {
    const { videoIds } = req.body;

    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return res.status(400).json({ error: 'videoIds must be a non-empty array' });
    }

    if (!spotifyService.isConfigured()) {
      return res.status(503).json({
        error: 'Spotify API not configured',
      });
    }

    const results = {
      total: videoIds.length,
      enriched: 0,
      skipped: 0,
      failed: 0,
      details: [] as any[],
    };

    const db = getDatabase();

    for (const videoId of videoIds) {
      try {
        // Get track
        const track = db
          .prepare(
            `SELECT video_id, title, channel_name, spotify_id 
             FROM cached_tracks 
             WHERE video_id = ?`
          )
          .get(videoId) as any;

        if (!track) {
          results.failed++;
          results.details.push({ videoId, status: 'not_found' });
          continue;
        }

        // Skip if already enriched
        if (track.spotify_id) {
          results.skipped++;
          results.details.push({ videoId, status: 'already_enriched', spotifyId: track.spotify_id });
          continue;
        }

        // Search and enrich
        const searchResult = await spotifyService.searchTrack(track.title, track.channel_name);

        if (!searchResult) {
          results.failed++;
          results.details.push({ videoId, status: 'no_match', title: track.title });
          continue;
        }

        const spotifyTrack = await spotifyService.getTrackDetails(searchResult.spotifyId);

        if (!spotifyTrack) {
          results.failed++;
          results.details.push({ videoId, status: 'fetch_failed' });
          continue;
        }

        // Update database
        db.prepare(
          `UPDATE cached_tracks 
           SET spotify_id = ?, 
               genres = ?, 
               audio_features = ?
           WHERE video_id = ?`
        ).run(
          spotifyTrack.id,
          JSON.stringify(spotifyTrack.genres),
          spotifyTrack.audioFeatures ? JSON.stringify(spotifyTrack.audioFeatures) : null,
          videoId
        );

        results.enriched++;
        results.details.push({
          videoId,
          status: 'success',
          spotifyId: spotifyTrack.id,
          matchScore: searchResult.matchScore,
        });

        // Rate limiting - wait 100ms between requests
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        logger.error(`Failed to enrich ${videoId}:`, error);
        results.failed++;
        results.details.push({ videoId, status: 'error' });
      }
    }

    logger.info(`📊 Batch enrichment complete: ${results.enriched}/${results.total} enriched`);

    return res.json(results);
  } catch (error) {
    logger.error('Error in batch enrichment:', error);
    return res.status(500).json({ error: 'Batch enrichment failed' });
  }
});

/**
 * Get track metadata including Spotify data
 * GET /api/spotify/track/:videoId
 */
router.get('/spotify/track/:videoId', (req: Request, res: Response) => {
  try {
    const { videoId } = req.params;
    const db = getDatabase();

    const track = db
      .prepare(
        `SELECT video_id, title, channel_name, spotify_id, genres, audio_features, tags, category, language
         FROM cached_tracks
         WHERE video_id = ?`
      )
      .get(videoId) as any;

    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }

    // Parse JSON fields
    const response = {
      videoId: track.video_id,
      title: track.title,
      channelName: track.channel_name,
      spotifyId: track.spotify_id,
      genres: track.genres ? JSON.parse(track.genres) : [],
      audioFeatures: track.audio_features ? JSON.parse(track.audio_features) : null,
      tags: track.tags ? JSON.parse(track.tags) : [],
      category: track.category,
      language: track.language,
    };

    return res.json(response);
  } catch (error) {
    logger.error('Error fetching track metadata:', error);
    return res.status(500).json({ error: 'Failed to fetch track metadata' });
  }
});

export default router;
