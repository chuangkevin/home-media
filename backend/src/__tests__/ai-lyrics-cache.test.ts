import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'

// Synthetic AI output in isolated SQLite. No audio or external AI calls.
const mocks = vi.hoisted(() => ({ db: null as any, key: vi.fn(), audio: vi.fn() }))
vi.mock('../config/database', () => ({ getDatabase: () => mocks.db }))
vi.mock('../services/gemini.service', () => ({
  getApiKey: mocks.key,
  getApiKeyExcluding: vi.fn(),
  markKeyBad: vi.fn(),
}))
vi.mock('../services/audio-cache.service', () => ({ default: { has: mocks.audio } }))
vi.mock('../utils/logger', () => ({ default: { warn: vi.fn() } }))
import { generateAILyrics } from '../services/ai-lyrics.service'
import { getCachedTranslation, saveTranslation } from '../services/translation-cache.service'

beforeEach(() => {
  mocks.db = new Database(':memory:')
  mocks.db.exec(
    'CREATE TABLE ai_lyrics_cache (video_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, cached_at INTEGER NOT NULL)'
  )
  mocks.key.mockReset().mockReturnValue(null)
  mocks.audio.mockReset()
})
afterEach(() => mocks.db.close())

it('permanent AI lyrics and translation remain available without an API key or audio file', async () => {
  const result = {
    language: 'en',
    lines: [{ time: 0, text: 'Synthetic AI source' }],
    translation: [{ time: 0, text: 'Synthetic AI translation' }],
  }
  mocks.db
    .prepare('INSERT INTO ai_lyrics_cache VALUES (?, ?, ?)')
    .run('synthetic-ai', JSON.stringify(result), 1)
  expect(await generateAILyrics('synthetic-ai')).toEqual(result)
  expect(mocks.key).not.toHaveBeenCalled()
  expect(mocks.audio).not.toHaveBeenCalled()
  expect(getCachedTranslation('synthetic-ai', ['Synthetic AI source'])).toEqual({
    detected_language: 'en',
    translations: ['Synthetic AI translation'],
  })
  expect(getCachedTranslation('synthetic-ai', ['Synthetic changed source'])).toBeNull()
  saveTranslation('synthetic-ai', ['Synthetic AI source'], {
    detected_language: 'en',
    translations: ['Synthetic explicit retranslation'],
  })
  await generateAILyrics('synthetic-ai')
  expect(getCachedTranslation('synthetic-ai', ['Synthetic AI source'])?.translations).toEqual([
    'Synthetic explicit retranslation',
  ])
})
