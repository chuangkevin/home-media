import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';

interface ExtractedTrackInfo {
  title: string;
  artist: string;
}

// Gemini API Key 管理
let cachedKeys: string[] = [];
let lastLoadTime = 0;
const CACHE_TTL = 60_000; // 60 秒快取
const badKeys = new Map<string, number>(); // key -> 失敗時間戳
const BAD_KEY_COOLDOWN = 2 * 60 * 1000; // 壞 key 冷卻 2 分鐘

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

function markKeyBad(key: string): void {
  badKeys.set(key, Date.now());
  console.warn(`🚫 [Gemini] Key ...${key.slice(-4)} marked bad, cooldown ${BAD_KEY_COOLDOWN / 1000}s`);
}

function getApiKey(): string | null {
  const keys = loadKeys();
  if (keys.length === 0) return null;

  // 過濾掉壞 key，從可用 key 中隨機選一個
  const goodKeys = keys.filter(k => !isKeyBad(k));

  if (goodKeys.length > 0) {
    return goodKeys[Math.floor(Math.random() * goodKeys.length)];
  }

  // 全部都壞了，清除最舊的壞 key 重試
  console.warn(`⚠️ [Gemini] All ${keys.length} keys are bad, clearing oldest`);
  let oldestKey = '';
  let oldestTime = Infinity;
  for (const [k, t] of badKeys) {
    if (t < oldestTime) { oldestTime = t; oldestKey = k; }
  }
  if (oldestKey) badKeys.delete(oldestKey);
  return oldestKey || keys[0];
}

function getApiKeyExcluding(failedKey: string): string | null {
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

  const prompt = `從以下 YouTube 影片標題中提取歌曲名稱和藝人名稱。
標題: "${youtubeTitle}"
${channelName ? `頻道: "${channelName}"` : ''}

只回傳 JSON，不要其他文字:
{"title": "歌曲名稱", "artist": "藝人名稱"}`;

  let currentKey = apiKey;
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const genai = new GoogleGenerativeAI(currentKey);
      const model = genai.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          maxOutputTokens: 100,
          temperature: 0,
        },
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();

      // 提取 JSON（可能被 ```json ``` 包裹）
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        console.warn(`⚠️ [Gemini] 無法解析回應: ${text}`);
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as ExtractedTrackInfo;
      if (parsed.title && parsed.artist) {
        console.log(`🤖 [Gemini] 提取成功: title="${parsed.title}", artist="${parsed.artist}" (原始: "${youtubeTitle}")`);
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

      if ((is429 || is403) && attempt < maxRetries) {
        const altKey = getApiKeyExcluding(currentKey);
        if (altKey) {
          console.warn(`⚠️ [Gemini] ${is429 ? '429' : '403'} on ...${currentKey.slice(-4)}, immediate switch to ...${altKey.slice(-4)}`);
          currentKey = altKey;
          continue; // 立即重試，不等待
        }
      }
      console.error(`❌ [Gemini] extractTrackInfo failed:`, msg);
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
  const maxRetries = 2;

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
  for (let attempt = 0; attempt <= 1; attempt++) {
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
      if ((is429 || is403) && attempt < 1) {
        const altKey = getApiKeyExcluding(currentKey);
        if (altKey) { currentKey = altKey; continue; }
      }
      console.error(`❌ [Gemini] generateDiscoveryQueries failed:`, msg);
      return [];
    }
  }
  return [];
}
