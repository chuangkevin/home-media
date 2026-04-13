import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';

interface ExtractedTrackInfo {
  title: string;
  artist: string;
  confidence?: 'high' | 'medium' | 'low';
}

// Gemini API Key 管理
let cachedKeys: string[] = [];
let lastLoadTime = 0;
const CACHE_TTL = 60_000; // 60 秒快取
const badKeys = new Map<string, number>(); // key -> 失敗時間戳
const BAD_KEY_COOLDOWN = 30 * 1000; // 壞 key 冷卻 30 秒（縮短以避免全滅）

/** 根據可用 key 數量決定最大重試次數（最多 5 次） */
function getMaxRetries(): number {
  return Math.min(loadKeys().length, 5);
}

function loadKeys(): string[] {
  const now = Date.now();
  if (cachedKeys.length > 0 && now - lastLoadTime < CACHE_TTL) {
    return cachedKeys;
  }

  const keys: string[] = [];

  // 1. 環境變數（支援逗號分隔多 key）
  const envKeys = process.env.GEMINI_API_KEY || '';
  if (envKeys) {
    envKeys.split(',').map(k => k.trim()).filter(k => k.length >= 20).forEach(k => keys.push(k));
  }

  // 2. 資料庫
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'gemini_api_keys'").get() as { value: string } | undefined;
    if (row && row.value) {
      row.value.split(',').map(k => k.trim()).filter(k => k.length >= 20).forEach(k => {
        if (!keys.includes(k)) keys.push(k);
      });
    }
  } catch {
    // DB 尚未初始化
  }

  cachedKeys = keys;
  lastLoadTime = now;
  return keys;
}

export function invalidateKeyCache(): void {
  lastLoadTime = 0;
  cachedKeys = [];
}

function isKeyBad(key: string): boolean {
  const failedAt = badKeys.get(key);
  if (!failedAt) return false;
  if (Date.now() - failedAt > BAD_KEY_COOLDOWN) {
    badKeys.delete(key); // 冷卻期過，重新嘗試
    return false;
  }
  return true;
}

export function markKeyBad(key: string): void {
  badKeys.set(key, Date.now());
  console.warn(`🚫 [Gemini] Key ...${key.slice(-4)} marked bad, cooldown ${BAD_KEY_COOLDOWN / 1000}s`);
}

export function getApiKey(): string | null {
  const keys = loadKeys();
  if (keys.length === 0) return null;

  // 過濾掉壞 key，從可用 key 中隨機選一個
  const goodKeys = keys.filter(k => !isKeyBad(k));

  if (goodKeys.length > 0) {
    return goodKeys[Math.floor(Math.random() * goodKeys.length)];
  }

  // 全部都壞了，清除所有 bad marks 重新嘗試
  console.warn(`⚠️ [Gemini] All ${keys.length} keys marked bad, clearing ALL bad marks`);
  badKeys.clear();
  return keys[Math.floor(Math.random() * keys.length)];
}

export function getApiKeyExcluding(failedKey: string): string | null {
  const keys = loadKeys().filter(k => k !== failedKey && !isKeyBad(k));
  if (keys.length === 0) return null;
  return keys[Math.floor(Math.random() * keys.length)];
}

/**
 * 用 Gemini 2.5 Flash 從 YouTube 標題提取歌名和藝人
 */
export async function extractTrackInfo(youtubeTitle: string, channelName?: string): Promise<ExtractedTrackInfo | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const prompt = `You are a music metadata extractor. Extract the song title and artist from this YouTube video title.

Common YouTube title formats to handle:
1. "Artist - Song Title" → artist="Artist", title="Song Title"
2. "Song Title - Artist" → artist="Artist", title="Song Title"
3. "【Song Title】Artist" or "Artist【Song Title】" → Chinese/Japanese style
4. "「Song Title」- Artist" or "Artist「Song Title」" → Japanese style (extract from brackets)
5. "Song Title / Artist MV" → slash-separated Japanese style
6. "Song Title feat. ArtistB" → main artist is ArtistA (from channel hint), feat. is secondary
7. Anime OP/ED: "[Anime OP] Song Title - Artist" or "「Song Title」from Anime" → extract actual song title, strip anime info
8. "Artist (English Name) - Song" → use original script name for artist
9. Korean: "Artist (아티스트명) - Song (곡명)" → use Korean name if available
10. "Song Title [Official MV] Channel Name" → strip labels, channel may be label not artist

Rules:
- Return the title in its ORIGINAL language. Do NOT translate (e.g. "愛にできることはまだあるかい" stays as-is, not "What Love Can Still Do")
- The channel name is a HINT only — it may be a label (e.g. "SMTOWN", "avex"), VEVO, or compilation channel, NOT necessarily the artist
- If channel ends in " - Topic", the part before " - Topic" is the artist
- Strip from title: (Official Video), (Official MV), (Lyric Video), (歌詞版), (完整版), (Live), (Audio), [MV], MV, Official Music Video, 音樂影片
- For covers: artist = the person doing the cover, not the original artist
- For live versions: artist = the performer
- If you cannot determine the artist with confidence, return "" for artist
- Prefer the most specific/native script for names (use 米津玄師 not Kenshi Yonezu, use BTS not 防弾少年団)

Video title: "${youtubeTitle}"
${channelName ? `Channel name (hint only): "${channelName}"` : ''}

Return ONLY valid JSON, no other text:
{"title": "song title in original language", "artist": "artist name or empty string", "confidence": "high|medium|low"}`;

  let currentKey = apiKey;
  const maxRetries = getMaxRetries();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const genai = new GoogleGenerativeAI(currentKey);
      const model = genai.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          maxOutputTokens: 2048,         // generous budget for thinking + output
          temperature: 0,
          responseMimeType: 'application/json', // forces raw JSON, no markdown wrapper
        },
      });

      // 15s timeout — 避免 Gemini hang 住導致整條歌詞管線卡死
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('extractTrackInfo timeout (15s)')), 15000)),
      ]);
      const text = result.response.text().trim();

      // 提取 JSON（可能被 ```json ``` 包裹）
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        console.warn(`⚠️ [Gemini] 無法解析回應: ${text}`);
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as ExtractedTrackInfo;
      if (parsed.title) {
        console.log(`🤖 [Gemini] 提取成功: title="${parsed.title}", artist="${parsed.artist || ''}", confidence="${parsed.confidence || 'unknown'}" (原始: "${youtubeTitle}")`);
        return parsed;
      }
      return null;
    } catch (err: any) {
      const msg = err?.message || '';
      const is429 = err?.status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      const is403 = err?.status === 403 || msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID');

      if (is403 || is429) {
        markKeyBad(currentKey); // 標記壞掉，2 分鐘冷卻
      }

      if (attempt < maxRetries) {
        // 429/403 換 key，其他錯誤（timeout/500/網路）也重試
        const altKey = (is429 || is403) ? getApiKeyExcluding(currentKey) : null;
        if (altKey) {
          console.warn(`⚠️ [Gemini] ${is429 ? '429' : '403'} on ...${currentKey.slice(-4)}, switch to ...${altKey.slice(-4)}`);
          currentKey = altKey;
        } else {
          console.warn(`⚠️ [Gemini] extractTrackInfo attempt ${attempt + 1} failed: ${msg}, retrying...`);
        }
        continue;
      }
      console.error(`❌ [Gemini] extractTrackInfo failed after ${maxRetries + 1} attempts:`, msg);
      return null;
    }
  }

  return null;
}

/**
 * 驗證 API Key 是否有效
 */
export async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { maxOutputTokens: 10 },
    });
    await model.generateContent('Say OK');
    return { valid: true };
  } catch (err: any) {
    const is429 = err?.status === 429 || err?.message?.includes('429');
    if (is429) return { valid: true }; // Rate limited = key is valid
    return { valid: false, error: err?.message || 'Invalid API key' };
  }
}

/**
 * 取得目前的 key 列表（只顯示後 4 碼）
 */
export function getKeyList(): Array<{ suffix: string; fromEnv: boolean }> {
  const envKeys = new Set<string>();
  const envStr = process.env.GEMINI_API_KEY || '';
  if (envStr) {
    envStr.split(',').map(k => k.trim()).filter(k => k.length >= 20).forEach(k => envKeys.add(k));
  }

  return loadKeys().map(k => ({
    suffix: k.slice(-4),
    fromEnv: envKeys.has(k),
  }));
}

/**
 * 批量新增 API Keys
 */
export function addKeys(newKeys: string[]): { added: number; skipped: number } {
  const existing = loadKeys();
  const toAdd = newKeys.filter(k => k.length >= 20 && !existing.includes(k));

  if (toAdd.length === 0) return { added: 0, skipped: newKeys.length };

  const allKeys = [...existing, ...toAdd];
  const dbKeys = allKeys.filter(k => {
    const envStr = process.env.GEMINI_API_KEY || '';
    return !envStr.split(',').map(e => e.trim()).includes(k);
  });

  try {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO settings (key, value, type, updated_at)
      VALUES ('gemini_api_keys', ?, 'string', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(dbKeys.join(','), Date.now());
  } catch (err) {
    logger.error('Failed to save API keys:', err);
  }

  invalidateKeyCache();
  return { added: toAdd.length, skipped: newKeys.length - toAdd.length };
}

/**
 * 移除 API Key（by suffix）
 */
export function removeKey(suffix: string): boolean {
  const keys = loadKeys();
  const target = keys.find(k => k.slice(-4) === suffix);
  if (!target) return false;

  const remaining = keys.filter(k => k !== target);
  const envStr = process.env.GEMINI_API_KEY || '';
  const dbKeys = remaining.filter(k => !envStr.split(',').map(e => e.trim()).includes(k));

  try {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO settings (key, value, type, updated_at)
      VALUES ('gemini_api_keys', ?, 'string', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(dbKeys.join(','), Date.now());
  } catch (err) {
    logger.error('Failed to remove API key:', err);
  }

  invalidateKeyCache();
  return true;
}

export function isConfigured(): boolean {
  return loadKeys().length > 0;
}

export interface TrackStyle {
  mood: string;
  genre: string;
  subgenre: string;
  energy: string;
  language: string;
  themes: string[];
}

export async function analyzeTrackStyle(
  title: string,
  channel?: string,
  tags?: string[],
  category?: string
): Promise<TrackStyle | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  const prompt = `Analyze this song and return JSON only. No other text.
Title: "${title}"
${channel ? `Channel: "${channel}"` : ''}
${tags?.length ? `Tags: ${JSON.stringify(tags)}` : ''}
${category ? `Category: "${category}"` : ''}

Return exactly this JSON format:
{"mood":"one of: energetic/chill/melancholic/upbeat/dark/dreamy/aggressive/romantic","genre":"primary genre in English","subgenre":"specific subgenre","energy":"one of: very-low/low/medium/high/very-high","language":"ISO 639-1 code like en/ja/zh/ko","themes":["max 3 keywords"]}`;

  let currentKey = apiKey;
  const maxRetries = getMaxRetries();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const genai = new GoogleGenerativeAI(currentKey);
      const model = genai.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          maxOutputTokens: 150,
          temperature: 0,
        },
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();

      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        console.warn(`⚠️ [Gemini] Style analysis: cannot parse response: ${text.substring(0, 100)}`);
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as TrackStyle;

      // Validate enum values
      const validMoods = ['energetic', 'chill', 'melancholic', 'upbeat', 'dark', 'dreamy', 'aggressive', 'romantic'];
      const validEnergy = ['very-low', 'low', 'medium', 'high', 'very-high'];

      if (!validMoods.includes(parsed.mood)) parsed.mood = 'chill';
      if (!validEnergy.includes(parsed.energy)) parsed.energy = 'medium';
      if (!Array.isArray(parsed.themes)) parsed.themes = [];
      parsed.themes = parsed.themes.slice(0, 3);

      console.log(`🎨 [Gemini] Style: ${parsed.mood}/${parsed.genre}/${parsed.energy} for "${title}"`);
      return parsed;
    } catch (err: any) {
      const msg = err?.message || '';
      const is429 = err?.status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      const is403 = err?.status === 403 || msg.includes('403') || msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID');

      if (is403 || is429) markKeyBad(currentKey);

      if ((is429 || is403) && attempt < maxRetries) {
        const altKey = getApiKeyExcluding(currentKey);
        if (altKey) {
          console.warn(`⚠️ [Gemini] ${is429 ? '429' : '403'} on style analysis, immediate switch`);
          currentKey = altKey;
          continue;
        }
      }
      console.error(`❌ [Gemini] analyzeTrackStyle failed:`, msg);
      return null;
    }
  }
  return null;
}

/**
 * 用 Gemini 根據用戶偏好生成 YouTube 搜尋關鍵字，發現新歌手
 */
export async function generateDiscoveryQueries(
  profile: {
    preferredMoods?: Record<string, number>;
    preferredGenres?: Record<string, number>;
    preferredLanguages?: Record<string, number>;
    topThemes?: string[];
  },
  listenedArtists: string[]
): Promise<string[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  const moods = Object.keys(profile.preferredMoods || {}).slice(0, 3).join(', ');
  const genres = Object.keys(profile.preferredGenres || {}).slice(0, 3).join(', ');
  const languages = Object.keys(profile.preferredLanguages || {}).slice(0, 2).join(', ');
  const themes = (profile.topThemes || []).slice(0, 3).join(', ');
  const excludeArtists = listenedArtists.slice(0, 10).join(', ');

  const prompt = `Based on this music taste profile:
- Moods: ${moods || 'unknown'}
- Genres: ${genres || 'unknown'}
- Languages: ${languages || 'unknown'}
- Themes: ${themes || 'unknown'}
- Already listened to: ${excludeArtists || 'unknown'}

Generate 5 YouTube search queries to discover NEW artists/songs this user would love but hasn't heard yet.
Each query should be a search term that would find good music on YouTube.
Focus on discovering new artists, not the ones already listened to.

Reply with ONLY a JSON array of strings, no other text:
["query1", "query2", "query3", "query4", "query5"]`;

  let currentKey = apiKey;
  const maxRetries = getMaxRetries();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const genai = new GoogleGenerativeAI(currentKey);
      const model = genai.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { maxOutputTokens: 200, temperature: 0.9 },
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();

      const jsonMatch = text.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) {
        console.warn(`⚠️ [Gemini] Discovery: invalid response: ${text}`);
        return [];
      }

      const queries = JSON.parse(jsonMatch[0]) as string[];
      console.log(`🔮 [Gemini] Discovery queries: ${queries.join(' | ')}`);
      return queries.filter(q => typeof q === 'string' && q.length > 0).slice(0, 5);
    } catch (err: any) {
      const msg = err?.message || '';
      const is429 = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      const is403 = msg.includes('403') || msg.includes('PERMISSION_DENIED');
      if (is403) markKeyBad(currentKey);
      if ((is429 || is403) && attempt < maxRetries) {
        const altKey = getApiKeyExcluding(currentKey);
        if (altKey) { currentKey = altKey; continue; }
      }
      console.error(`❌ [Gemini] generateDiscoveryQueries failed (attempt ${attempt + 1}):`, msg);
      if (attempt < maxRetries) continue;
      return [];
    }
  }
  return [];
}

/**
 * 用 Gemini 翻譯歌詞為繁體中文
 * - 偵測語言：中文不翻，簡體轉繁體
 * - 韓文/日文/英文/其他 → 翻譯成繁體中文
 * - 批量翻譯（一次送所有歌詞行）
 */
export async function translateLyrics(
  lines: string[]
): Promise<{ translations: string[]; detected_language: string } | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    const keys = loadKeys();
    console.error(`❌ [Gemini] translateLyrics: no API key available. loadKeys() returned ${keys.length} keys, all bad?`);
    return null;
  }
  if (lines.length === 0) return { translations: [], detected_language: 'unknown' };

  // 超過 200 行的歌詞分批處理（避免 Gemini token 限制）
  if (lines.length > 200) {
    console.log(`🌐 [Gemini] 歌詞 ${lines.length} 行太多，只翻譯前 200 行`);
    const truncated = lines.slice(0, 200);
    const result = await translateLyrics(truncated);
    if (result) {
      // 補齊剩餘行為空字串
      while (result.translations.length < lines.length) {
        result.translations.push('');
      }
    }
    return result;
  }

  // 過濾掉純標記行
  const cleanLines = lines.map(l => l.replace(/\[(?:Music|Applause|Laughter|Cheering|Instrumental)\]/gi, '').trim());

  const prompt = `You are a lyrics translator. Translate song lyrics to Traditional Chinese (繁體中文).

Rules:
1. Detect the PRIMARY language of the lyrics (the most common language)
2. If a line is already in Traditional Chinese: return it unchanged
3. If a line is in Simplified Chinese: convert to Traditional Chinese
4. If a line is in English/Japanese/Korean/other: translate to natural Traditional Chinese
5. IMPORTANT: For mixed-language songs (e.g. English + Chinese), translate EACH line independently based on its own language. Do NOT skip translation just because some lines are Chinese.
6. You MUST translate EVERY single line. Do NOT skip any line index.
7. The output JSON MUST have exactly ${cleanLines.length} keys (from "0" to "${cleanLines.length - 1}").
8. If a line is instrumental or empty, return "" for that index — do NOT omit it.
9. Keep proper nouns and names in original form.
10. detected_language should reflect the PRIMARY language (e.g. "mixed" for mixed-language songs, "en" for mostly English, "zh-TW" for PURELY Traditional Chinese).
11. CRITICAL: Use the line index as the key in the translations object. Empty lines get an empty string "".

Lyrics (${cleanLines.length} lines):
${cleanLines.map((l, i) => `${i}: ${l}`).join('\n')}

Reply with ONLY a JSON object where each key is a line index (as a string):
{"detected_language": "en", "translations": {"0": "第一行翻譯", "1": "第二行翻譯", "2": "", ...}}`;

  let currentKey = apiKey;
  const maxRetries = getMaxRetries();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const genai = new GoogleGenerativeAI(currentKey);
      const model = genai.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { maxOutputTokens: 4096, temperature: 0.3 },
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`⚠️ [Gemini] Translation: invalid response`);
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Support both indexed-object format {"0": "trans", "1": "trans"} and legacy array format
      let translationsArray: string[];
      if (Array.isArray(parsed.translations)) {
        // Legacy array format — pad to correct length (may still have shift if Gemini skipped lines)
        translationsArray = parsed.translations as string[];
        while (translationsArray.length < lines.length) translationsArray.push('');
        translationsArray = translationsArray.slice(0, lines.length);
        if (translationsArray.length !== lines.length) {
          console.warn(`⚠️ [Gemini] Translation array length mismatch: expected ${lines.length}, got ${translationsArray.length}`);
        }
      } else if (parsed.translations && typeof parsed.translations === 'object') {
        // Indexed-object format — reconstruct array by index, missing indices become ''
        const map = parsed.translations as Record<string, string>;
        translationsArray = Array.from({ length: lines.length }, (_, i) => map[String(i)] ?? '');
        const covered = Object.keys(map).filter(k => Number(k) < lines.length).length;
        if (covered < lines.length) {
          console.warn(`⚠️ [Gemini] Translation object missing ${lines.length - covered} indices (filled with '')`);
        }
      } else {
        return null;
      }

      // Validate coverage: if <50% of lines translated, retry with different key
      const nonEmptyCount = translationsArray.filter(t => t.length > 0).length;
      const coverage = nonEmptyCount / lines.length;
      if (coverage < 0.5 && attempt < maxRetries) {
        console.warn(`⚠️ [Gemini] Translation coverage too low: ${(coverage * 100).toFixed(0)}% (${nonEmptyCount}/${lines.length}), retrying...`);
        const altKey = getApiKeyExcluding(currentKey);
        if (altKey) currentKey = altKey;
        continue;
      }

      parsed.translations = translationsArray;

      console.log(`🌐 [Gemini] Translated ${lines.length} lines, coverage ${(coverage * 100).toFixed(0)}% (${parsed.detected_language}→zh-TW)`);
      return parsed;
    } catch (err: any) {
      const msg = err?.message || '';
      const is429 = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      const is403 = msg.includes('403') || msg.includes('PERMISSION_DENIED');
      if (is403 || is429) markKeyBad(currentKey);
      if ((is429 || is403) && attempt < maxRetries) {
        const altKey = getApiKeyExcluding(currentKey);
        if (altKey) {
          console.warn(`🔄 [Gemini] translateLyrics retry ${attempt + 1}/${maxRetries} with different key`);
          currentKey = altKey;
          continue;
        }
      }
      console.error(`❌ [Gemini] translateLyrics failed (attempt ${attempt + 1}/${maxRetries + 1}):`, msg);
      if (attempt < maxRetries) continue; // 非 429/403 也繼續重試（可能是暫時性錯誤）
      return null;
    }
  }
  return null;
}
