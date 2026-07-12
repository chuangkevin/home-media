import { getDatabase } from '../config/database';

export interface OpenCodeServer {
  id: string;
  label: string;
  baseUrl: string;
}

export const OPENCODE_VARIANTS = ['default', 'medium', 'high'] as const;
export type OpenCodeVariant = typeof OPENCODE_VARIANTS[number];

function getSetting(key: string): string | null {
  try {
    const row = getDatabase()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function setSetting(key: string, value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value, type, updated_at)
       VALUES (?, ?, 'string', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, type = excluded.type, updated_at = excluded.updated_at`
    )
    .run(key, value, Date.now());
}

function deleteSetting(key: string): void {
  getDatabase().prepare('DELETE FROM settings WHERE key = ?').run(key);
}

// ── Server list ───────────────────────────────────────────────────────────────

function parseServers(raw: string): OpenCodeServer[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as Array<{ id?: string; label?: string; baseUrl?: string; url?: string }>;
      return arr
        .map((s, i) => ({
          id: s.id ?? `opencode-${i + 1}`,
          label: s.label ?? `OpenCode ${i + 1}`,
          baseUrl: (s.baseUrl ?? s.url ?? '').replace(/\/$/, ''),
        }))
        .filter(s => s.baseUrl.length > 0);
    } catch {
      // fall through to line parsing
    }
  }
  return raw
    .split(/[\n,]/)
    .map(u => u.trim().replace(/\/$/, ''))
    .filter(u => u.startsWith('http'))
    .map((u, i) => ({ id: `opencode-${i + 1}`, label: `OpenCode ${i + 1}`, baseUrl: u }));
}

export function getOpenCodeServers(): OpenCodeServer[] {
  const dbVal = getSetting('opencode.servers');
  if (dbVal) return parseServers(dbVal);
  const envServers = process.env.OPENCODE_SERVERS;
  if (envServers) return parseServers(envServers);
  const envUrl = process.env.OPENCODE_URL || process.env.OPENCODE_BASE_URL;
  if (envUrl) return [{ id: 'opencode-1', label: 'OpenCode 1', baseUrl: envUrl.replace(/\/$/, '') }];
  return [];
}

export function setOpenCodeServers(value: string): void {
  if (!value.trim()) { deleteSetting('opencode.servers'); return; }
  setSetting('opencode.servers', value.trim());
}

// ── Text model ────────────────────────────────────────────────────────────────

// Free, vision-capable OpenCode Zen model (used as both text + vision default).
// The old openai/gpt-5.5 default is dead: No-OpenAI rule + paid Zen models 401
// on a 0 workspace balance.
const DEFAULT_MODEL = 'opencode/mimo-v2.5-free';

export function getOpenCodeTextModel(): string {
  return getSetting('opencode.textModel') || process.env.OPENCODE_MODEL || DEFAULT_MODEL;
}

export function setOpenCodeTextModel(value: string): void {
  if (!value.trim()) { deleteSetting('opencode.textModel'); return; }
  setSetting('opencode.textModel', value.trim());
}

// ── Vision model ──────────────────────────────────────────────────────────────

export function getOpenCodeVisionModel(): string {
  return getSetting('opencode.visionModel') || process.env.OPENCODE_VISION_MODEL || DEFAULT_MODEL;
}

export function setOpenCodeVisionModel(value: string): void {
  if (!value.trim()) { deleteSetting('opencode.visionModel'); return; }
  setSetting('opencode.visionModel', value.trim());
}

// ── Variants ──────────────────────────────────────────────────────────────────

const DEFAULT_VARIANT: OpenCodeVariant = 'medium';

export function getOpenCodeTextVariant(): string {
  return getSetting('opencode.textVariant') || process.env.OPENCODE_TEXT_VARIANT || DEFAULT_VARIANT;
}

export function setOpenCodeTextVariant(value: string): void {
  if (!value) { deleteSetting('opencode.textVariant'); return; }
  setSetting('opencode.textVariant', value);
}

export function getOpenCodeVisionVariant(): string {
  return getSetting('opencode.visionVariant') || process.env.OPENCODE_VISION_VARIANT || DEFAULT_VARIANT;
}

export function setOpenCodeVisionVariant(value: string): void {
  if (!value) { deleteSetting('opencode.visionVariant'); return; }
  setSetting('opencode.visionVariant', value);
}

// ── Password ──────────────────────────────────────────────────────────────────

export function getOpenCodePassword(): string {
  return process.env.OPENCODE_SERVER_PASSWORD || '';
}

// ── Status ────────────────────────────────────────────────────────────────────

function sourceOf(dbKey: string, envKey?: string): 'setting' | 'env' | 'default' {
  if (getSetting(dbKey)) return 'setting';
  if (envKey && process.env[envKey]) return 'env';
  return 'default';
}

function serversSource(): 'setting' | 'env' | 'default' {
  if (getSetting('opencode.servers')) return 'setting';
  if (process.env.OPENCODE_SERVERS || process.env.OPENCODE_URL || process.env.OPENCODE_BASE_URL) return 'env';
  return 'default';
}

export function getOpenCodeStatus() {
  return {
    servers: getOpenCodeServers(),
    serversSource: serversSource(),
    envUrl: process.env.OPENCODE_URL || process.env.OPENCODE_BASE_URL || '',
    textModel: getOpenCodeTextModel(),
    textModelSource: sourceOf('opencode.textModel', 'OPENCODE_MODEL'),
    visionModel: getOpenCodeVisionModel(),
    visionModelSource: sourceOf('opencode.visionModel', 'OPENCODE_VISION_MODEL'),
    textVariant: getOpenCodeTextVariant(),
    textVariantSource: sourceOf('opencode.textVariant', 'OPENCODE_TEXT_VARIANT'),
    visionVariant: getOpenCodeVisionVariant(),
    visionVariantSource: sourceOf('opencode.visionVariant', 'OPENCODE_VISION_VARIANT'),
  };
}

// ── Clear ─────────────────────────────────────────────────────────────────────

export function clearOpenCodeSettings(): void {
  for (const key of [
    'opencode.servers', 'opencode.textModel', 'opencode.visionModel',
    'opencode.textVariant', 'opencode.visionVariant',
  ]) {
    try { deleteSetting(key); } catch { /* ignore */ }
  }
}

// ── Model list ────────────────────────────────────────────────────────────────

export interface OpenCodeModel {
  id: string;
  name: string;
  provider: string;
}

export async function listOpenCodeModels(): Promise<{
  models: OpenCodeModel[];
  sourceServerId: string | null;
  warning: string | null;
}> {
  const servers = getOpenCodeServers();
  if (servers.length === 0) {
    return { models: [], sourceServerId: null, warning: 'No OpenCode servers configured' };
  }

  const password = getOpenCodePassword();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (password) {
    headers['Authorization'] = `Basic ${Buffer.from(`:${password}`).toString('base64')}`;
  }

  for (const server of servers) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${server.baseUrl}/provider`, { headers, signal: controller.signal });
      if (!res.ok) continue;
      const data = await res.json() as {
        all?: Array<{ id?: string; models?: Record<string, { id?: string; name?: string; cost?: { input?: number; output?: number } }> }>;
        providers?: Array<{ id?: string; models?: Record<string, { id?: string; name?: string; cost?: { input?: number; output?: number } }> }>;
      };

      // Only free models: the Zen workspace balance is 0, so any paid model
      // (opencode-go/*, and paid models inside `opencode` such as gpt-5.5) returns
      // 401. `openai` is banned by the No-OpenAI rule. Filter by cost so the list
      // stays correct on its own as OpenCode adds/removes models.
      const providerList = data.all ?? data.providers ?? [];
      const models: OpenCodeModel[] = [];
      for (const provider of providerList) {
        const providerID = String(provider?.id ?? '');
        if (!providerID || providerID === 'opencode-go' || providerID === 'openai') continue;
        for (const modelData of Object.values(provider?.models ?? {})) {
          if (!(modelData?.cost?.input === 0 && modelData?.cost?.output === 0)) continue;
          const modelID = String(modelData?.id ?? '');
          if (!modelID) continue;
          models.push({
            id: `${providerID}/${modelID}`,
            name: modelData.name ?? modelID,
            provider: providerID,
          });
        }
      }
      if (models.length > 0) return { models, sourceServerId: server.id, warning: null };
    } catch {
      // try next server
    } finally {
      clearTimeout(timeout);
    }
  }

  return { models: [], sourceServerId: null, warning: 'All OpenCode servers unreachable or returned no models' };
}
