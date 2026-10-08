import assert from 'node:assert/strict'
import test from 'node:test'
import audioCacheService from '../../src/services/audio-cache.service'
import { audioCacheDatabase } from './helpers/fake-audio-cache-db'

interface CacheEntry {
  videoId: string
  blob: Blob
  timestamp: number
  size: number
}

function createRequest(result: unknown) {
  const request: any = { result, error: null }
  queueMicrotask(() => request.onsuccess?.({ target: request }))
  return request
}

test('audio-cache writes preserve replacements, evict only as needed, and skip oversized items', async (t) => {
  const service = audioCacheService as any
  const originalMaxEntries = service.MAX_ENTRIES
  const originalMaxCacheSize = service.MAX_CACHE_SIZE
  t.after(() => {
    service.MAX_ENTRIES = originalMaxEntries
    service.MAX_CACHE_SIZE = originalMaxCacheSize
  })

  const entries = new Map<string, CacheEntry>([
    ['oldest', { videoId: 'oldest', blob: new Blob(['aaaa']), timestamp: 1, size: 4 }],
    ['middle', { videoId: 'middle', blob: new Blob(['b']), timestamp: 2, size: 1 }],
    ['newest', { videoId: 'newest', blob: new Blob(['c']), timestamp: 3, size: 1 }],
  ])
  const { db: database } = audioCacheDatabase(entries)

  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: { open: () => createRequest(database) },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: () => true },
  })
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }))
  t.after(() => {
    if (indexedDbDescriptor) Object.defineProperty(globalThis, 'indexedDB', indexedDbDescriptor)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
    else Reflect.deleteProperty(globalThis, 'window')
  })

  service.MAX_ENTRIES = 3
  service.MAX_CACHE_SIZE = 5

  // Replacing an existing key removes its prior size/count from the limit
  // calculation; it must not evict another song just because the cache is full.
  await audioCacheService.set('oldest', new Blob(['123']))
  assert.deepEqual([...entries.keys()].sort(), ['middle', 'newest', 'oldest'])
  assert.equal(entries.get('oldest')?.size, 3)

  // A genuinely new track at the entry limit evicts the oldest unrelated key.
  await audioCacheService.set('fourth', new Blob(['d']))
  assert.deepEqual([...entries.keys()].sort(), ['fourth', 'newest', 'oldest'])
  assert.equal(entries.size, service.MAX_ENTRIES)

  // The byte limit evicts oldest entries until the incoming blob fits.
  service.MAX_CACHE_SIZE = 4
  await audioCacheService.set('size-limited', new Blob(['123']))
  assert.equal(entries.has('newest'), false)
  assert.equal(entries.has('size-limited'), true)
  assert.equal(
    [...entries.values()].reduce((sum, entry) => sum + entry.size, 0),
    4
  )

  // A single item larger than the limit is not cached and must not purge the
  // entries that were already within the limit.
  const retained = [...entries.keys()].sort()
  await audioCacheService.set('oversized', new Blob(['12345']))
  assert.deepEqual([...entries.keys()].sort(), retained)
  assert.equal(entries.has('oversized'), false)
})
