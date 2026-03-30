import { Router, Request, Response } from 'express';
import { getDatabase } from '../config/database';
import { analyzeAndCache, getStyle } from '../services/style-cache.service';
import { translateLyrics } from '../services/gemini.service';
import { generateAILyrics } from '../services/ai-lyrics.service';
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
    db.prepare(`UPDATE cached_tracks SET ${column} = COALESCE(${column}, 0) + 1 WHERE video_id = ?`).run(videoId);
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
  const { lines } = req.body;

  if (!Array.isArray(lines) || lines.length === 0) {
    res.status(400).json({ error: 'lines array is required' });
    return;
  }

  try {
    const db = getDatabase();

    // 建立快取表（如果不存在）
    db.exec(`
      CREATE TABLE IF NOT EXISTS lyrics_translations (
        video_id TEXT PRIMARY KEY,
        translations_json TEXT NOT NULL,
        detected_language TEXT,
        cached_at INTEGER NOT NULL
      )
    `);

    // 檢查快取
    const cached = db.prepare(
      'SELECT translations_json, detected_language FROM lyrics_translations WHERE video_id = ?'
    ).get(videoId) as { translations_json: string; detected_language: string } | undefined;

    if (cached) {
      res.json({
        translations: JSON.parse(cached.translations_json),
        detected_language: cached.detected_language,
        cached: true,
      });
      return;
    }

    // 呼叫 Gemini 翻譯
    const result = await translateLyrics(lines);
    if (!result) {
      res.status(503).json({ error: 'Translation failed (Gemini not configured or unavailable)' });
      return;
    }

    // 中文不翻（zh-TW 原樣返回，zh-CN 已轉繁體）
    // 快取結果
    db.prepare(
      `INSERT INTO lyrics_translations (video_id, translations_json, detected_language, cached_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET translations_json = excluded.translations_json, detected_language = excluded.detected_language, cached_at = excluded.cached_at`
    ).run(videoId, JSON.stringify(result.translations), result.detected_language, Date.now());

    res.json({
      translations: result.translations,
      detected_language: result.detected_language,
      cached: false,
    });
  } catch (err) {
    logger.error(`Failed to translate lyrics for ${videoId}:`, err);
    res.status(500).json({ error: 'Translation failed' });
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
