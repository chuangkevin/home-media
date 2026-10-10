import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'

// Synthetic fixtures, isolated SQLite only; translator never calls an AI provider.
const mocks = vi.hoisted(() => ({ db: null as any, translate: vi.fn() }))
vi.mock('../config/database', () => ({ getDatabase: () => mocks.db }))
vi.mock('../services/style-cache.service', () => ({ analyzeAndCache: vi.fn(), getStyle: vi.fn() }))
vi.mock('../services/gemini.service', () => ({ translateLyrics: mocks.translate }))
vi.mock('../services/ai-lyrics.service', () => ({ generateAILyrics: vi.fn() }))
vi.mock('../utils/logger', () => ({ default: { error: vi.fn() } }))
import router from '../routes/track.routes'
import { getCachedTranslation, saveTranslation } from '../services/translation-cache.service'

const handler = (router as any).stack.find(
  (layer: any) => layer.route?.path === '/:videoId/translate'
).route.stack[0].handle
async function request(lines: string[], extra = {}) {
  let body: any,
    status = 200
  const res: any = {
    status(code: number) {
      status = code
      return res
    },
    json(value: any) {
      body = value
      return res
    },
  }
  await handler(
    { params: { videoId: 'synthetic-video' }, body: { lines, ...extra }, app: { get: () => null } },
    res
  )
  return { status, body }
}
beforeEach(() => {
  mocks.db = new Database(':memory:')
  mocks.translate.mockReset().mockImplementation(async (lines: string[]) => ({
    translations: lines.map((line) => `Synthetic translation: ${line}`),
    detected_language: 'en',
  }))
})
afterEach(() => {
  vi.useRealTimers()
  mocks.db.close()
})

it('persists multiple lyrics versions rather than overwriting on source switches', async () => {
  expect((await request(['Synthetic source A'])).body.cached).toBe(false)
  expect((await request(['Synthetic source B'])).body.cached).toBe(false)
  expect((await request(['Synthetic source A'])).body.cached).toBe(true)
  expect(mocks.translate).toHaveBeenCalledTimes(2)
})
it('translation remains cached after years, including after reopening SQLite', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1)
  await request(['Synthetic old lyrics'])
  const snapshot = mocks.db.serialize()
  mocks.db.close()
  mocks.db = new Database(snapshot)
  clock.mockReturnValue(10 ** 13)
  expect((await request(['Synthetic old lyrics'])).body.cached).toBe(true)
  expect(mocks.translate).toHaveBeenCalledTimes(1)
  vi.restoreAllMocks()
})
it('line boundaries distinguish source versions even with embedded newline text', async () => {
  await request(['Synthetic a\nb', 'c'])
  const second = await request(['Synthetic a', 'b\nc'])
  expect(second.body.cached).toBe(false)
  expect(second.body.translations).toEqual([
    'Synthetic translation: Synthetic a',
    'Synthetic translation: b\nc',
  ])
})
it('explicit force replaces one translation without TTL or removing other versions', async () => {
  const lines = ['Synthetic original']
  await request(lines)
  mocks.translate.mockResolvedValueOnce({
    translations: ['Synthetic revised translation'],
    detected_language: 'en',
  })
  expect((await request(lines, { force: true })).body.cached).toBe(false)
  expect((await request(lines)).body.translations).toEqual(['Synthetic revised translation'])
  await request(['Synthetic other version'])
  await request(lines, { force: true })
  expect((await request(['Synthetic other version'])).body.cached).toBe(true)
})
it('permanent storage keys isolate target languages and video IDs', () => {
  const lines = ['Synthetic shared text']
  saveTranslation(
    'synthetic-video',
    lines,
    { translations: ['Synthetic zh-TW result'], detected_language: 'en' },
    'zh-TW'
  )
  saveTranslation(
    'synthetic-video',
    lines,
    { translations: ['Synthetic ja result'], detected_language: 'en' },
    'ja'
  )
  expect(getCachedTranslation('synthetic-video', lines, 'zh-TW')?.translations).toEqual([
    'Synthetic zh-TW result',
  ])
  expect(getCachedTranslation('synthetic-video', lines, 'ja')?.translations).toEqual([
    'Synthetic ja result',
  ])
  expect(getCachedTranslation('synthetic-other-video', lines, 'zh-TW')).toBeNull()
})
it('does not serve Traditional Chinese under an unsupported target language key', async () => {
  await request(['Synthetic target test'])
  expect((await request(['Synthetic target test'], { targetLanguage: 'en' })).status).toBe(400)
  expect(mocks.translate).toHaveBeenCalledTimes(1)
})
it('failed explicit retranslation preserves the existing permanent result', async () => {
  const lines = ['Synthetic failure source']
  const original = await request(lines)
  mocks.translate.mockResolvedValueOnce(null)
  expect((await request(lines, { force: true })).status).toBe(503)
  const retained = await request(lines)
  expect(retained.body.cached).toBe(true)
  expect(retained.body.translations).toEqual(original.body.translations)
})

it('preserves matching legacy translations without retranslation', async () => {
  const lines = ['Synthetic legacy lyrics']
  const hash = createHash('md5')
    .update('v2' + lines.join('\n'))
    .digest('hex')
    .substring(0, 16)
  mocks.db.exec(
    'CREATE TABLE lyrics_translations (video_id TEXT PRIMARY KEY, translations_json TEXT, detected_language TEXT, lines_hash TEXT, cached_at INTEGER)'
  )
  mocks.db
    .prepare('INSERT INTO lyrics_translations VALUES (?, ?, ?, ?, ?)')
    .run('synthetic-video', JSON.stringify(['Synthetic legacy translation']), 'en', hash, 1)
  const result = await request(lines)
  expect(result.body.cached).toBe(true)
  expect(result.body.translations).toEqual(['Synthetic legacy translation'])
  expect(mocks.translate).not.toHaveBeenCalled()
})
