import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { handoffAudioToCache } from '../../src/services/audio-cache-handoff'

class Audio extends EventTarget {
  src = ''
  paused = false
  muted = false
  volume = 0.7
  playbackRate = 1.25
  currentTime = 10
  readyState = 4
  seeking = false
  error = null
  networkState = 1
  buffered = { length: 1 }
  plays = 0
  getAttribute() {
    return this.src || null
  }
  removeAttribute() {
    this.src = ''
  }
  load() {
    this.readyState = 0
  }
  pause() {
    this.paused = true
  }
  play() {
    this.paused = false
    this.plays++
    return Promise.resolve()
  }
}
function crossfade(primary: Audio, candidate: Audio) {
  const filename = path.resolve(process.cwd(), 'src/hooks/useCrossfade.ts')
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} as any }
  const state = {
    radio: { isHost: true, isListener: false },
    player: { displayMode: 'audio', playlist: [], currentIndex: 0, volume: 0.7 },
  }
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    AbortController,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    URL,
    console: { log() {}, warn() {} },
    localStorage: { getItem: () => 'true' },
    require(name: string) {
      if (name === 'react')
        return {
          useRef: (value: unknown) => ({ current: value }),
          useCallback: (fn: unknown) => fn,
          useEffect: () => {},
        }
      if (name === 'react-redux') return { useSelector: (fn: any) => fn(state) }
      if (name.endsWith('audio-cache.service')) return { get: async () => null }
      if (name.endsWith('api.service')) return { getStreamUrl: () => '/next-stream' }
      throw new Error('Unexpected dependency ' + name)
    },
  })
  return module.exports.useCrossfade({
    primaryAudioRef: { current: primary },
    secondaryAudioRef: { current: candidate },
    onCrossfadeComplete() {},
  })
}

test('failed, timed-out and aborted cache leases cannot mute the subsequent real crossfade callbacks', async () => {
  for (const failure of ['error', 'timeout', 'cancel'] as const) {
    for (const ownerMuted of [false, true]) {
      const primary = new Audio(),
        candidate = new Audio()
      primary.muted = ownerMuted
      const engine = crossfade(primary, candidate)
      const lease = engine.claimSecondaryForCache()
      assert.ok(lease)
      const handoff = handoffAudioToCache({
        primary: primary as any,
        candidate: candidate as any,
        url: 'blob:cache',
        signal: lease.signal,
        isCurrent: lease.isCurrent,
        getIntent: () => ({ playing: true, volume: 0.7, muted: ownerMuted, playbackRate: 1.25 }),
        commit: () => assert.fail('unready candidate must not commit'),
        timeoutMs: 10,
      })
      assert.equal(candidate.muted, true)
      if (failure === 'error') candidate.dispatchEvent(new Event('error'))
      if (failure === 'cancel') engine.cancelCrossfade()
      assert.equal(await handoff, false)
      lease.release()
      assert.equal(candidate.muted, false, 'failed secondary returns to neutral paused state')
      assert.equal(candidate.playbackRate, 1)
      assert.equal(await engine.preloadNextTrack({ videoId: 'next', title: 'Next' }), true)
      assert.ok(engine.startCrossfade())
      assert.equal(candidate.plays, 1)
      assert.equal(
        candidate.muted,
        ownerMuted,
        'incoming track inherits actual current owner mute intent'
      )
      assert.equal(candidate.playbackRate, primary.playbackRate)
      engine.cancelCrossfade()
    }
  }
})
