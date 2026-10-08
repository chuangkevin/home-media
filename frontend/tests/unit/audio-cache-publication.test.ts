import assert from 'node:assert/strict'
import test from 'node:test'
import audioCacheService from '../../src/services/audio-cache.service'
import { audioCacheDatabase } from './helpers/fake-audio-cache-db'
import { readAudioCacheBody } from '../../src/services/audio-cache-body'

function setup(t: any, options = {}) {
  // Node's child test reporter can corrupt frames on non-ASCII application stdout.
  // Keep assertions and error logs intact; silence only routine service logs.
  t.mock.method(console, 'log', () => {})
  const { db, entries } = audioCacheDatabase(new Map(), options)
  const service = new (audioCacheService as any).constructor()
  service.db = db
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: () => true },
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  t.mock.method(globalThis, 'fetch', async () => new Response('0000ftypM4A cache bytes'))
  return { service, entries }
}

test('real cache service waits for asynchronous limit read and transaction commit before one-shot handoff read', async (t) => {
  const { service } = setup(t, { readDelay: 20, commitDelay: 30 })
  let completed = false
  const download = service.fetchAndCache('publication', '/audio').then(() => {
    completed = true
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(completed, false)
  await download
  assert.ok(
    await service.get('publication'),
    'successful resolution guarantees immediately readable publication'
  )
})

test('quota failure after put success rejects cache completion and rolls back evictions', async (t) => {
  const { service, entries } = setup(t, { quotaFailure: true })
  entries.set('old', { videoId: 'old', blob: new Blob(['old']), size: 3, timestamp: Date.now() })
  service.MAX_ENTRIES = 1
  await assert.rejects(service.fetchAndCache('new', '/audio'), { name: 'QuotaExceededError' })
  assert.deepEqual([...entries.keys()], ['old'])
})

test('concurrent cache publications serialize eviction accounting and remain within limits', async (t) => {
  const { service, entries } = setup(t, { readDelay: 10, commitDelay: 10 })
  service.MAX_ENTRIES = 1
  await Promise.all([service.set('a', new Blob(['aaa'])), service.set('b', new Blob(['bbb']))])
  assert.equal(entries.size, 1)
  assert.equal(entries.has('b'), true)
})

test('next-track cancellation before commit aborts publication without evicting existing audio', async (t) => {
  const controller = new AbortController()
  const { service, entries } = setup(t, { beforeCommit: () => controller.abort() })
  entries.set('old', { videoId: 'old', blob: new Blob(['old']), size: 3, timestamp: Date.now() })
  service.MAX_ENTRIES = 1
  const outcome = await service
    .fetchAndCache('next', '/audio', undefined, { signal: controller.signal })
    .then(
      () => 'unexpected success',
      (error: Error) => error.name
    )
  assert.equal(outcome, 'AbortError')
  assert.deepEqual([...entries.keys()], ['old'])
})

test('bounded cache body rejects dishonest or excessive bodies and cancels the reader', async () => {
  let cancelled = false
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(8))
        c.enqueue(new Uint8Array(8))
      },
      cancel() {
        cancelled = true
      },
    })
  )
  await assert.rejects(
    readAudioCacheBody(response, new AbortController().signal, 10),
    /body budget/
  )
  assert.equal(cancelled, true)
  const valid = await readAudioCacheBody(
    new Response('audio', { headers: { 'content-type': 'audio/mp4' } }),
    new AbortController().signal,
    10
  )
  assert.equal(valid.size, 5)
  assert.equal(valid.type, 'audio/mp4')
})
