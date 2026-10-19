import assert from 'node:assert/strict'
import test from 'node:test'
import axios from 'axios'

// apiService.instanceaurants: use its internal axios instance with a mock
// adapter so this test can run arbitrary concurrency without network.
import apiService from '../../src/services/api.service'

interface MockCall { url: string; aborted: boolean; resolved: boolean }

function installLyricsMockAdapter(store: MockCall[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instance = (apiService as any).api as { defaults: { adapter?: unknown } }
  const CanceledError = new (axios.CanceledError as unknown as { new (message: string): Error })('canceled')
  instance.defaults.adapter = (config: { url?: string; signal?: AbortSignal }) =>
    new Promise((resolve, reject) => {
      const entry: MockCall = { url: config.url ?? '', aborted: false, resolved: false }
      store.push(entry)
      const onAbort = () => {
        entry.aborted = true
        reject(CanceledError)
      }
      config.signal?.addEventListener('abort', onAbort)
      if (entry.url.includes('/AAAA')) {
        // The slow pipeline: never resolves on its own; only abort ends it.
        return
      }
      setTimeout(() => {
        entry.resolved = true
        resolve({
          status: 200,
          data: { videoId: 'BBBB', lyrics: { videoId: 'BBBB', lines: [{ time: 0, text: 'mock' }], source: 'lrclib', isSynced: true } },
          headers: {},
          config,
          statusText: 'OK',
        })
      }, 5)
    })
}

test('concurrent getLyrics callers: aborting one must not cancel the other', async () => {
  const store: MockCall[] = []
  installLyricsMockAdapter(store)

  const controllerA = new AbortController()
  const controllerB = new AbortController()

  // A = the slow main-sheet request (e.g. full multi-source pipeline).
  const a = apiService.getLyrics('AAAA', 'Slow Song', 'Artist', undefined, { signal: controllerA.signal })
  // B = e.g. a remote-device sync event or panel reload.
  const b = apiService.getLyrics('BBBB', 'Other Song', 'Artist', undefined, { signal: controllerB.signal })

  await new Promise((resolve) => setTimeout(resolve, 15))
  // The old implementation aborted A at this point as a side effect of B starting.
  controllerA.abort()

  const lyricsB = await b
  const resultA = await a

  assert.equal(lyricsB?.videoId, 'BBBB', 'the other caller must still receive lyrics')
  assert.equal(resultA, null, 'the aborted caller returns null without throwing')
  const callA = store.find((entry) => entry.url.includes('/AAAA'))
  assert.equal(callA?.aborted, true)
  const callB = store.find((entry) => entry.url.includes('/BBBB'))
  assert.equal(callB?.resolved, true, 'the surviving request was never aborted')
})

test('getLyrics maps 404 responses to null (no lyrics exists)', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instance = (apiService as any).api as { defaults: { adapter?: unknown } }
  instance.defaults.adapter = () =>
    Promise.reject({
      isAxiosError: true,
      response: { status: 404 },
      config: {},
    })
  const lyrics = await apiService.getLyrics('CCCC', 'No Song', 'Artist')
  assert.equal(lyrics, null)
})
