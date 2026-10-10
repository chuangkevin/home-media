import { Router, Request, Response } from 'express';
import { getDatabase } from '../config/database';
import { analyzeAndCache, getStyle } from '../services/style-cache.service';
import { translateLyrics } from '../services/gemini.service';
import { generateAILyrics } from '../services/ai-lyrics.service';
import { getCachedTranslation, saveTranslation } from '../services/translation-cache.service';
import logger from '../utils/logger';

const router = Router();

// POST /api/tracks/:videoId/signal - Record skip/complete event
router.post('/:videoId/signal', (req: Request, res: Response): void => {
  const { videoId } = req.params;
  const { type } = req.body;

  if (!type || !['skip', 'complete'].includes(type)) {
    res.status(400).json({ error: 'type must be "skip" or "complete"' });
    return;
  }

  try {
    const db = getDatabase();
    const column = type === 'skip' ? 'skip_count' : 'complete_count';
    if (type === 'complete') {
      db.prepare(`UPDATE cached_tracks SET ${column} = COALESCE(${column}, 0) + 1, play_count = COALESCE(play_count, 0) + 1, last_played = ? WHERE video_id = ?`).run(Date.now(), videoId);
    } else {
      db.prepare(`UPDATE cached_tracks SET ${column} = COALESCE(${column}, 0) + 1 WHERE video_id = ?`).run(videoId);
    }
    res.json({ success: true });
  } catch (err) {
    logger.error(`Failed to record ${type} for ${videoId}:`, err);
    res.status(500).json({ error: 'Failed to record signal' });
  }
});

// POST /api/tracks/:videoId/style - Analyze track style
router.post('/:videoId/style', async (req: Request, res: Response): Promise<void> => {
  const { videoId } = req.params;
  const { title, channel, tags, category } = req.body;

  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }

  try {
    const style = await analyzeAndCache(videoId, title, channel, tags, category);
    if (style) {
      res.json(style);
    } else {
      res.status(404).json({ error: 'Could not analyze style (Gemini not configured or failed)' });
    }
  } catch (err) {
    logger.error(`Failed to analyze style for ${videoId}:`, err);
    res.status(500).json({ error: 'Style analysis failed' });
  }
});

// GET /api/tracks/:videoId/style - Get cached style
router.get('/:videoId/style', (req: Request, res: Response): void => {
  const { videoId } = req.params;
  const style = getStyle(videoId);
  if (style) {
    res.json(style);
  } else {
    res.status(404).json({ error: 'No style data for this track' });
  }
});

// POST /api/tracks/:videoId/translate - Translate lyrics to Traditional Chinese
router.post('/:videoId/translate', async (req: Request, res: Response): Promise<void> => {
  const { videoId } = req.params;
  const { lines, targetLanguage = 'zh-TW', force = false } = req.body;

  if (!Array.isArray(lines) || lines.length === 0 || !lines.every(line => typeof line === 'string')) {
    res.status(400).json({ error: 'lines array is required' });
    return;
  }

  // The current translator supports Traditional Chinese only. Never cache a
  // zh-TW result under another requested language; future targets get own keys.
  if (targetLanguage !== 'zh-TW' || typeof force !== 'boolean') {
    res.status(400).json({ error: 'targetLanguage must be zh-TW and force must be boolean' });
    return;
  }

  try {
    const cached = force ? null : getCachedTranslation(videoId, lines, targetLanguage);
    if (cached) {
      const cachedTranslations = cached.translations;
      res.json({
        translations: cachedTranslations,
        detected_language: cached.detected_language,
        cached: true,
      });
      // 廣播翻譯結果給所有連線裝置
      try {
        const io = req.app.get('io');
        if (io) {
          io.emit('lyrics:translation-ready', { videoId, translations: cachedTranslations, sourceLines: lines, targetLanguage });
        }
      } catch {}
      return;
    }

    const result = await translateLyrics(lines);
    if (!result) {
      res.status(503).json({ error: 'Translation failed (Gemini not configured or unavailable)' });
      return;
    }

    // Permanently save this content/language version; force explicitly replaces it.
    saveTranslation(videoId, lines, result, targetLanguage);

    res.json({
      translations: result.translations,
      detected_language: result.detected_language,
      cached: false,
    });
    // 廣播翻譯結果給所有連線裝置
    try {
      const io = req.app.get('io');
      if (io) {
        io.emit('lyrics:translation-ready', { videoId, translations: result.translations, sourceLines: lines, targetLanguage });
      }
    } catch {}
  } catch (err) {
    logger.error(`Failed to translate lyrics for ${videoId}:`, err);
    res.status(500).json({ error: 'Translation failed' });
  }
});

// DELETE /api/tracks/:videoId/ai-lyrics - Clear AI lyrics cache (force re-generate)
router.delete('/:videoId/ai-lyrics', (req: Request, res: Response): void => {
  const { videoId } = req.params;
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM ai_lyrics_cache WHERE video_id = ?').run(videoId);
    res.json({ success: true });
  } catch {
    res.json({ success: true }); // Silently succeed even if table doesn't exist
  }
});

// POST /api/tracks/:videoId/ai-lyrics - AI 音訊辨識生成歌詞
router.post('/:videoId/ai-lyrics', async (req: Request, res: Response): Promise<void> => {
  const { videoId } = req.params;

  try {
    const result = await generateAILyrics(videoId);
    if (result) {
      res.json(result);
    } else {
      res.status(503).json({ error: 'AI lyrics generation failed (audio not cached or Gemini unavailable)' });
    }
  } catch (err) {
    logger.error(`Failed to generate AI lyrics for ${videoId}:`, err);
    res.status(500).json({ error: 'AI lyrics generation failed' });
  }
});

export default router;
