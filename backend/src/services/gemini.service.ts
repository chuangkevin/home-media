import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDatabase } from '../config/database';
import logger from '../utils/logger';

interface ExtractedTrackInfo {
  title: string;
  artist: string;
}

// Gemini API Key 管理
let cachedKeys: string[] = [];
let keyIndex = 0;
let lastLoadTime = 0;
const CACHE_TTL = 60_000; // 60 秒快取

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

function getApiKey(): string | null {
  const keys = loadKeys();
  if (keys.length === 0) return null;
  const key = keys[keyIndex % keys.length];
  keyIndex = (keyIndex + 1) % keys.length;
  return key;
}

function getApiKeyExcluding(failedKey: string): string | null {
  const keys = loadKeys().filter(k => k !== failedKey);
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
      const is429 = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED');
      if (is429 && attempt < maxRetries) {
        const altKey = getApiKeyExcluding(currentKey);
        if (altKey) {
          console.warn(`⚠️ [Gemini] 429 on key ...${currentKey.slice(-4)}, switching to ...${altKey.slice(-4)}`);
          currentKey = altKey;
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
      }
      console.error(`❌ [Gemini] extractTrackInfo failed:`, err?.message || err);
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
