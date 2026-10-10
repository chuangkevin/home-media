import { beforeEach, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'

// Synthetic, in-memory fixtures only. Never opens the application's database.
const mocks = vi.hoisted(() => ({ db: null as any }))
vi.mock('../config/database', () => ({
  getDatabase: () => mocks.db,
  get db() {
    return mocks.db
  },
}))
vi.mock('../services/gemini.service', () => ({}))
vi.mock('simple-netease-cloud-music', () => ({ default: class {} }))
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
import lyricsService from '../services/lyrics.service'

beforeEach(() => {
  mocks.db?.close()
  mocks.db = new Database(':memory:')
  mocks.db.exec(
    `CREATE TABLE lyrics_cache (video_id TEXT PRIMARY KEY, lyrics TEXT, source TEXT, is_synced INTEGER, cached_at INTEGER)`
  )
})

it('legacy age-based cleanup must not delete permanent lyrics', () => {
  const lyrics = {
    videoId: 'synthetic-old',
    lines: [{ time: 0, text: 'Synthetic lyrics' }],
    source: 'manual',
    isSynced: true,
  }
  mocks.db
    .prepare('INSERT INTO lyrics_cache VALUES (?, ?, ?, ?, ?)')
    .run(lyrics.videoId, JSON.stringify(lyrics), lyrics.source, 1, 1)
  expect(lyricsService.clearExpiredCache(30)).toBe(0)
  expect(mocks.db.prepare('SELECT COUNT(*) AS count FROM lyrics_cache').get().count).toBe(1)
  expect((lyricsService as any).getFromCache(lyrics.videoId)).toEqual(lyrics)
  expect(lyricsService.clearCacheForVideo(lyrics.videoId)).toBe(true)
  expect(mocks.db.prepare('SELECT COUNT(*) AS count FROM lyrics_cache').get().count).toBe(0)
})
