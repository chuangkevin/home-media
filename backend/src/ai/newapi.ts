// New API gateway client — the single entry point for every model at home.
// The radio backend used to carry a pool of Gemini API keys; that approach is
// retired. Model choice is stored in the settings table (`ai_model`) and can
// be changed from the app's settings page.
import { getDatabase } from '../config/database';
import logger from '../utils/logger';

const BASE_URL = (process.env.NEWAPI_BASE_URL || 'https://newapi.sisihome.org/v1').replace(/\/+$/, '');
const API_KEY = process.env.NEWAPI_API_KEY || '';
const DEFAULT_MODEL = process.env.NEWAPI_MODEL || 'gemini-flash';

// Short cooldown when the gateway is unreachable or rate limited, so lyrics and
// recommendation calls never stall on repeated network retries.
const FAILURE_COOLDOWN_MS = 120000;
let blockedUntil = 0;
let cachedModel: { value: string; at: number } | null = null;

export function isConfigured(): boolean {
  return API_KEY.length > 0;
}

export function getSelectedModel(): string {
  if (cachedModel && Date.now() - cachedModel.at < 30000) return cachedModel.value;
  try {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'ai_model'").get() as { value?: string } | undefined;
    const value = row?.value?.trim() || DEFAULT_MODEL;
    cachedModel = { value, at: Date.now() };
    return value;
  } catch {
    return DEFAULT_MODEL;
  }
}

export function invalidateModelCache(): void {
  cachedModel = null;
}

export function isCoolingDown(): boolean {
  return Date.now() < blockedUntil;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function listModels(timeoutMs = 8000): Promise<string[]> {
  if (!isConfigured()) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/models`, { headers: headers(), signal: controller.signal });
    if (!res.ok) {
      logger.warn(`[newapi] /models returned ${res.status}`);
      return [];
    }
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    return (body.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id)).sort();
  } catch (error) {
    logger.warn(`[newapi] /models unreachable: ${(error as Error).message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export interface ChatOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  model?: string;
  maxTokens?: number;
}

/**
 * One JSON-mode chat completion through the gateway. Returns the raw text,
 * or null when the gateway is not configured / cooling down / failed.
 */
export async function chatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options: ChatOptions = {},
): Promise<string | null> {
  if (!isConfigured() || isCoolingDown()) return null;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    const request = (useJsonMode: boolean) => fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: headers(),
      signal: controller.signal,
      body: JSON.stringify({
        model: options.model || getSelectedModel(),
        messages,
        temperature: 0,
        max_tokens: options.maxTokens ?? 800,
        ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    let res = await request(true);
    // Some local models reject JSON mode (structured_output_failed). Retry once
    // without it; callers already parse JSON out of the raw text.
    if (!res.ok && res.status !== 429 && res.status !== 503) {
      res = await request(false);
    }
    if (res.status === 429 || res.status === 503) {
      blockedUntil = Date.now() + FAILURE_COOLDOWN_MS;
      logger.warn(`[newapi] ${res.status} — pausing AI calls for ${FAILURE_COOLDOWN_MS / 1000}s`);
      return null;
    }
    if (!res.ok) {
      logger.warn(`[newapi] chat completions ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return body.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    // Network/DNS failures (e.g. the NAS has no tailnet route) — pause instead
    // of retrying on every song.
    blockedUntil = Date.now() + FAILURE_COOLDOWN_MS;
    logger.warn(`[newapi] unreachable: ${(error as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
