import { getDatabase } from '../config/database';
import { analyzeTrackStyle } from './gemini.service';
import { isConfigured as isGeminiConfigured } from './gemini.service';
import logger from '../utils/logger';

export interface CachedTrackStyle {
  videoId: string;
  mood: string;
  genre: string;
  subgenre: string;
  energy: string;
  language: string;
  themes: string[];
  analyzedAt: number;
}

// Background analysis queue
let analysisQueue: Array<{ videoId: string; title: string; channel?: string; tags?: string[]; category?: string }> = [];
let isProcessing = false;
const ANALYSIS_INTERVAL_MS = 6000; // 6 seconds between API calls (10 RPM limit)

/**
 * Get cached style for a track
 */
export function getStyle(videoId: string): CachedTrackStyle | null {
  try {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM track_styles WHERE video_id = ?').get(videoId) as any;
    if (!row) return null;
    return {
      videoId: row.video_id,
      mood: row.mood,
      genre: row.genre,
      subgenre: row.subgenre || '',
      energy: row.energy,
      language: row.language || '',
      themes: row.themes ? JSON.parse(row.themes) : [],
      analyzedAt: row.analyzed_at,
    };
  } catch (err) {
    logger.warn('Failed to get cached style:', err);
    return null;
  }
}

/**
 * Get styles for multiple tracks at once
 */
export function getStyles(videoIds: string[]): Map<string, CachedTrackStyle> {
  const result = new Map<string, CachedTrackStyle>();
  if (videoIds.length === 0) return result;

  try {
    const db = getDatabase();
    const placeholders = videoIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM track_styles WHERE video_id IN (${placeholders})`).all(...videoIds) as any[];
    for (const row of rows) {
      result.set(row.video_id, {
        videoId: row.video_id,
        mood: row.mood,
        genre: row.genre,
        subgenre: row.subgenre || '',
        energy: row.energy,
        language: row.language || '',
        themes: row.themes ? JSON.parse(row.themes) : [],
        analyzedAt: row.analyzed_at,
      });
    }
  } catch (err) {
    logger.warn('Failed to get cached styles:', err);
  }
  return result;
}

/**
 * Analyze and cache a single track's style
 */
export async function analyzeAndCache(
  videoId: string,
  title: string,
  channel?: string,
  tags?: string[],
  category?: string
): Promise<CachedTrackStyle | null> {
  // Check cache first
  const cached = getStyle(videoId);
  if (cached) return cached;

  if (!isGeminiConfigured()) return null;

  const style = await analyzeTrackStyle(title, channel, tags, category);
  if (!style) return null;

  try {
    const db = getDatabase();
    const now = Date.now();
    db.prepare(`
      INSERT OR REPLACE INTO track_styles (video_id, mood, genre, subgenre, energy, language, themes, analyzed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(videoId, style.mood, style.genre, style.subgenre || '', style.energy, style.language || '', JSON.stringify(style.themes), now);

    return {
      videoId,
      mood: style.mood,
      genre: style.genre,
      subgenre: style.subgenre || '',
      energy: style.energy,
      language: style.language || '',
      themes: style.themes,
      analyzedAt: now,
    };
  } catch (err) {
    logger.error('Failed to cache style:', err);
    return null;
  }
}

/**
 * Queue tracks for background analysis
 */
export function queueForAnalysis(tracks: Array<{ videoId: string; title: string; channel?: string; tags?: string[]; category?: string }>): void {
  if (!isGeminiConfigured()) return;

  // Filter out already-analyzed tracks
  const uncached = tracks.filter(t => !getStyle(t.videoId));
  if (uncached.length === 0) return;

  // Add to queue (dedup)
  const existingIds = new Set(analysisQueue.map(t => t.videoId));
  for (const track of uncached) {
    if (!existingIds.has(track.videoId)) {
      analysisQueue.push(track);
      existingIds.add(track.videoId);
    }
  }

  console.log(`📊 [StyleCache] Queued ${uncached.length} tracks for analysis (total queue: ${analysisQueue.length})`);

  // Start processing if not already running
  if (!isProcessing) {
    processQueue();
  }
}

/**
 * Prioritize a specific track (move to front of queue)
 */
export function prioritize(videoId: string, title: string, channel?: string, tags?: string[], category?: string): void {
  if (!isGeminiConfigured()) return;
  if (getStyle(videoId)) return; // Already cached

  // Remove from queue if exists
  analysisQueue = analysisQueue.filter(t => t.videoId !== videoId);
  // Add to front
  analysisQueue.unshift({ videoId, title, channel, tags, category });

  if (!isProcessing) {
    processQueue();
  }
}

/**
 * Process the analysis queue sequentially with rate limiting
 */
async function processQueue(): Promise<void> {
  if (isProcessing || analysisQueue.length === 0) return;
  isProcessing = true;

  console.log(`📊 [StyleCache] Starting queue processing (${analysisQueue.length} tracks)`);

  while (analysisQueue.length > 0) {
    const track = analysisQueue.shift()!;

    // Skip if already cached (might have been cached while waiting)
    if (getStyle(track.videoId)) continue;

    try {
      await analyzeAndCache(track.videoId, track.title, track.channel, track.tags, track.category);
    } catch (err) {
      console.warn(`⚠️ [StyleCache] Failed to analyze ${track.videoId}:`, err);
    }

    // Rate limit: wait 6 seconds between calls
    if (analysisQueue.length > 0) {
      await new Promise(r => setTimeout(r, ANALYSIS_INTERVAL_MS));
    }
  }

  isProcessing = false;
  console.log(`📊 [StyleCache] Queue processing complete`);
}

/**
 * Generate user preference profile from top played tracks
 */
export async function generateUserProfile(): Promise<any | null> {
  try {
    const db = getDatabase();

    // Get top 50 most-played tracks that have style data
    const tracks = db.prepare(`
      SELECT ts.mood, ts.genre, ts.subgenre, ts.energy, ts.language, ts.themes
      FROM cached_tracks ct
      JOIN track_styles ts ON ct.video_id = ts.video_id
      WHERE ct.play_count > 0
      ORDER BY ct.play_count DESC
      LIMIT 50
    `).all() as any[];

    if (tracks.length < 10) return null;

    // Aggregate moods
    const moodCounts: Record<string, number> = {};
    const genreCounts: Record<string, number> = {};
    const energyCounts: Record<string, number> = {};
    const languageCounts: Record<string, number> = {};
    const allThemes: string[] = [];

    for (const t of tracks) {
      moodCounts[t.mood] = (moodCounts[t.mood] || 0) + 1;
      genreCounts[t.genre] = (genreCounts[t.genre] || 0) + 1;
      if (t.subgenre) genreCounts[t.subgenre] = (genreCounts[t.subgenre] || 0) + 0.5;
      energyCounts[t.energy] = (energyCounts[t.energy] || 0) + 1;
      if (t.language) languageCounts[t.language] = (languageCounts[t.language] || 0) + 1;
      if (t.themes) {
        try {
          const themes = JSON.parse(t.themes);
          allThemes.push(...themes);
        } catch {}
      }
    }

    const total = tracks.length;
    const normalize = (counts: Record<string, number>) => {
      const result: Record<string, number> = {};
      for (const [key, count] of Object.entries(counts)) {
        result[key] = Math.round((count / total) * 100) / 100;
      }
      return Object.fromEntries(
        Object.entries(result).sort(([,a], [,b]) => b - a).slice(0, 5)
      );
    };

    // Top themes by frequency
    const themeCounts: Record<string, number> = {};
    for (const theme of allThemes) {
      const t = theme.toLowerCase();
      themeCounts[t] = (themeCounts[t] || 0) + 1;
    }
    const topThemes = Object.entries(themeCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([theme]) => theme);

    const profile = {
      preferredMoods: normalize(moodCounts),
      preferredGenres: normalize(genreCounts),
      preferredEnergy: normalize(energyCounts),
      preferredLanguages: normalize(languageCounts),
      topThemes,
      tracksAnalyzed: tracks.length,
      generatedAt: Date.now(),
    };

    // Cache in settings
    db.prepare(`
      INSERT INTO settings (key, value, type, updated_at)
      VALUES ('user_preference_profile', ?, 'string', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(JSON.stringify(profile), Date.now());

    console.log(`📊 [Profile] Generated user preference profile from ${tracks.length} tracks`);
    return profile;
  } catch (err) {
    logger.error('Failed to generate user profile:', err);
    return null;
  }
}

/**
 * Get cached user profile, regenerate if stale
 */
export async function getUserProfile(): Promise<any | null> {
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT value, updated_at FROM settings WHERE key = 'user_preference_profile'").get() as any;

    if (row) {
      const profile = JSON.parse(row.value);
      const ageMs = Date.now() - row.updated_at;
      const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

      if (ageMs < WEEK_MS) {
        return profile;
      }
    }

    // Profile doesn't exist or is stale - regenerate
    return await generateUserProfile();
  } catch (err) {
    logger.error('Failed to get user profile:', err);
    return null;
  }
}
