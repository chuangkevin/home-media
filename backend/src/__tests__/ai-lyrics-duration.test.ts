import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
// Isolated synthetic fixture: real service callback, no real audio or AI call.
const mocks = vi.hoisted(() => ({ db: null as any, parse: vi.fn() }));
vi.mock('../config/database', () => ({ getDatabase: () => mocks.db }));
vi.mock('../services/audio-cache.service', () => ({ default: { getCachePath: () => '/synthetic-audio.m4a', has: () => true } }));
vi.mock('../services/gemini.service', () => ({ getApiKey: () => null, getApiKeyExcluding: vi.fn(), markKeyBad: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('fs', () => ({ existsSync: () => true, readFileSync: () => Buffer.from('synthetic audio') }));
vi.mock('music-metadata', () => ({ parseFile: mocks.parse }));
import { generateAILyrics } from '../services/ai-lyrics.service';
beforeEach(() => {
  mocks.db = new Database(':memory:');
  mocks.db.exec('CREATE TABLE ai_lyrics_cache (video_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, cached_at INTEGER NOT NULL)');
  mocks.parse.mockResolvedValue({ format: { duration: 133.19 } });
});
afterEach(() => mocks.db.close());
it('cached AI timestamps past actual audio duration are refused without deleting permanent evidence', async () => {
  const result = { language: 'en', lines: [{ time: 209.923, text: 'Synthetic lyric after audio ended' }] };
  mocks.db.prepare('INSERT INTO ai_lyrics_cache VALUES (?,?,?)').run('synthetic-duration', JSON.stringify(result), 1);
  expect(await generateAILyrics('synthetic-duration')).toBeNull();
  expect(mocks.db.prepare('SELECT result_json FROM ai_lyrics_cache WHERE video_id=?').get('synthetic-duration')).toBeTruthy();
});
