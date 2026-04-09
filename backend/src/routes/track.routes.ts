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
    // complete 同時累加 play_count（用於播放清單顯示「播放 X 次」）
    if (type === 'complete') {
      db.prepare(`UPDATE cached_tracks SET play_count = COALESCE(play_count, 0) + 1 WHERE video_id = ?`).run(videoId);
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
        lines_hash TEXT,
        cached_at INTEGER NOT NULL
      )
    `);

    // 加 lines_hash 欄位（如果舊表缺少）
    try {
      db.exec('ALTER TABLE lyrics_translations ADD COLUMN lines_hash TEXT');
    } catch { /* column already exists */ }

    // 用歌詞內容的 hash 驗證快取有效性（避免換歌詞來源後翻譯錯位）
    // v2: 使用 indexed-object 格式避免行數不符導致的位移問題
    const TRANSLATION_PROMPT_VERSION = 'v2';
    const crypto = await import('crypto');
    const linesHash = crypto.createHash('md5').update(TRANSLATION_PROMPT_VERSION + lines.join('\n')).digest('hex').substring(0, 16);

    // 檢查快取（必須 hash 匹配才用）
    const cached = db.prepare(
      'SELECT translations_json, detected_language, lines_hash FROM lyrics_translations WHERE video_id = ?'
    ).get(videoId) as { translations_json: string; detected_language: string; lines_hash: string | null } | undefined;

    if (cached && cached.lines_hash === linesHash) {
      const cachedTranslations = JSON.parse(cached.translations_json);
      // 額外驗證：行數必須匹配
      if (Array.isArray(cachedTranslations) && cachedTranslations.length === lines.length) {
        res.json({
          translations: cachedTranslations,
          detected_language: cached.detected_language,
          cached: true,
        });
        // 廣播翻譯結果給所有連線裝置
        try {
          const io = req.app.get('io');
          if (io) {
            io.emit('lyrics:translation-ready', { videoId, translations: cachedTranslations });
          }
        } catch {}
        return;
      }
    }

    // 快取不存在或 hash 不匹配 → 重新翻譯
    if (cached && cached.lines_hash !== linesHash) {
      console.log(`🔄 [Translate] Cache hash mismatch for ${videoId}, re-translating`);
    }

    const result = await translateLyrics(lines);
    if (!result) {
      res.status(503).json({ error: 'Translation failed (Gemini not configured or unavailable)' });
      return;
    }

    // 快取結果（含 hash）
    db.prepare(
      `INSERT INTO lyrics_translations (video_id, translations_json, detected_language, lines_hash, cached_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET translations_json = excluded.translations_json, detected_language = excluded.detected_language, lines_hash = excluded.lines_hash, cached_at = excluded.cached_at`
    ).run(videoId, JSON.stringify(result.translations), result.detected_language, linesHash, Date.now());

    res.json({
      translations: result.translations,
      detected_language: result.detected_language,
      cached: false,
    });
    // 廣播翻譯結果給所有連線裝置
    try {
      const io = req.app.get('io');
      if (io) {
        io.emit('lyrics:translation-ready', { videoId, translations: result.translations });
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
