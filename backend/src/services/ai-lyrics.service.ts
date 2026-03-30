import * as fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import { getDatabase } from '../config/database';
import audioCacheService from './audio-cache.service';
import logger from '../utils/logger';

// Reuse key management from gemini.service
import { getApiKey, getApiKeyExcluding, markKeyBad } from './gemini.service';

interface LyricsLine {
  time: number;
  text: string;
}

interface AILyricsResult {
  lines: LyricsLine[];
  language: string;
  translation?: LyricsLine[]; // 繁體中文翻譯（非中文歌時）
}

/**
 * AI 歌詞辨識服務
 * 用 Gemini 2.5 Flash 聽音訊檔案，生成帶時間戳的歌詞 + 翻譯
 */
export async function generateAILyrics(videoId: string): Promise<AILyricsResult | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('⚠️ [AI Lyrics] No Gemini API key configured');
    return null;
  }

  // 檢查快取
  const cached = getCachedAILyrics(videoId);
  if (cached) return cached;

  // 確認音訊檔案存在
  if (!audioCacheService.has(videoId)) {
    console.warn(`⚠️ [AI Lyrics] Audio not cached: ${videoId}`);
    return null;
  }

  const audioPath = audioCacheService.getCachePath(videoId);
  const audioBuffer = fs.readFileSync(audioPath);
  const audioBase64 = audioBuffer.toString('base64');
  const audioSize = audioBuffer.length;

  // 超過 15MB 跳過（免費額度限制）
  if (audioSize > 15 * 1024 * 1024) {
    console.warn(`⚠️ [AI Lyrics] Audio too large: ${(audioSize / 1024 / 1024).toFixed(1)}MB`);
    return null;
  }

  console.log(`🎤 [AI Lyrics] Analyzing audio: ${videoId} (${(audioSize / 1024 / 1024).toFixed(1)}MB)`);

  const prompt = `You are a professional lyrics transcriber. Listen to this audio and transcribe the lyrics with accurate timestamps.

Output format - MUST be valid JSON:
{
  "language": "en",
  "lines": [
    {"time": 0.0, "text": "first line of lyrics"},
    {"time": 5.2, "text": "second line"},
    ...
  ],
  "translation": [
    {"time": 0.0, "text": "第一行歌詞的繁體中文翻譯"},
    {"time": 5.2, "text": "第二行的翻譯"},
    ...
  ]
}

Rules:
1. "time" is in seconds (decimal, e.g. 65.3 for 1:05.3)
2. Each line should be a natural phrase/sentence of the lyrics
3. Timestamps must be accurate to the audio
4. "language" is ISO code of the PRIMARY language (en, ja, ko, zh-CN, zh-TW, etc.)
5. "translation" array: translate each line to Traditional Chinese (繁體中文)
   - If lyrics are already in Traditional Chinese (zh-TW): omit "translation" field
   - If lyrics are in Simplified Chinese (zh-CN): "translation" should be the Traditional Chinese version
   - For all other languages: provide natural Traditional Chinese translation
6. Keep the same number of entries in "lines" and "translation"
7. Only include actual sung lyrics, not instrumental sections
8. Reply with ONLY the JSON, no other text`;

  let currentKey = apiKey;
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const ai = new GoogleGenAI({ apiKey: currentKey });

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'audio/mp4', data: audioBase64 } },
            { text: prompt },
          ],
        }],
        config: {
          maxOutputTokens: 8192,
          temperature: 0.2,
        },
      });

      const text = response.text?.trim() || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`⚠️ [AI Lyrics] Invalid response format`);
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) {
        console.warn(`⚠️ [AI Lyrics] No lyrics found in response`);
        return null;
      }

      // 驗證和清理
      const result: AILyricsResult = {
        language: parsed.language || 'unknown',
        lines: parsed.lines
          .filter((l: any) => typeof l.time === 'number' && typeof l.text === 'string' && l.text.trim())
          .map((l: any) => ({ time: l.time, text: l.text.trim() })),
      };

      if (Array.isArray(parsed.translation) && parsed.translation.length > 0) {
        result.translation = parsed.translation
          .filter((l: any) => typeof l.time === 'number' && typeof l.text === 'string' && l.text.trim())
          .map((l: any) => ({ time: l.time, text: l.text.trim() }));
      }

      console.log(`✅ [AI Lyrics] Generated ${result.lines.length} lines (${result.language}) for ${videoId}`);

      // 快取結果
      cacheAILyrics(videoId, result);
      return result;

    } catch (err: any) {
      const msg = err?.message || '';
      const is429 = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      const is403 = msg.includes('403') || msg.includes('PERMISSION_DENIED');
      if (is403 || is429) markKeyBad(currentKey);
      if ((is429 || is403) && attempt < 1) {
        const altKey = getApiKeyExcluding(currentKey);
        if (altKey) { currentKey = altKey; continue; }
      }
      console.error(`❌ [AI Lyrics] Failed:`, msg);
      return null;
    }
  }
  return null;
}

function getCachedAILyrics(videoId: string): AILyricsResult | null {
  try {
    const db = getDatabase();
    db.exec(`CREATE TABLE IF NOT EXISTS ai_lyrics_cache (
      video_id TEXT PRIMARY KEY,
      result_json TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    )`);
    const row = db.prepare('SELECT result_json FROM ai_lyrics_cache WHERE video_id = ?').get(videoId) as any;
    if (row) return JSON.parse(row.result_json);
  } catch {}
  return null;
}

function cacheAILyrics(videoId: string, result: AILyricsResult): void {
  try {
    const db = getDatabase();
    db.prepare(`INSERT INTO ai_lyrics_cache (video_id, result_json, cached_at)
      VALUES (?, ?, ?) ON CONFLICT(video_id) DO UPDATE SET result_json = excluded.result_json, cached_at = excluded.cached_at
    `).run(videoId, JSON.stringify(result), Date.now());
  } catch (err) {
    logger.warn('AI lyrics cache save error:', err);
  }
}
