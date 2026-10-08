import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  handoffAudioToCache,
  type AudioHandoffIntent,
} from '../../src/services/audio-cache-handoff'
import {
  setActivePlaybackAudio,
  clearActivePlaybackAudio,
  getActivePlaybackAudio,
} from '../../src/services/active-audio'

class FakeAudio extends EventTarget {
  dataset: Record<string, string> = {}
  isConnected = true
  readyState = 4
  networkState = 1
  error = null
  buffered = { length: 1 }
  paused = true
  seeking = false
  muted = false
  volume = 0.7
  playbackRate = 1
  private time = 0
  src = ''
  loads = 0
  plays = 0
  pauses = 0
  manualReady = false
  manualSeek = false
  failPlay = false
  deferredPlay: (() => void) | null = null
  delayPlay = false
  onPlay: (() => void) | null = null
  get currentTime() {
    return this.time
  }
  set currentTime(time: number) {
    this.time = time
    this.seeking = true
    this.dispatchEvent(new Event('seeking'))
    if (!this.manualSeek) queueMicrotask(() => this.seekComplete())
  }
  setLiveTime(time: number) {
    this.time = time
  }
  get currentSrc() {
    return this.src
  }
  getAttribute(name: string) {
    return name === 'src' ? this.src || null : null
  }
  removeAttribute(name: string) {
    if (name === 'src') this.src = ''
  }
  load() {
    this.loads++
    this.readyState = 0
    const src = this.src
    if (src && !this.manualReady)
      queueMicrotask(() => {
        if (this.src === src) this.ready()
      })
  }
  ready() {
    this.readyState = 4
    this.dispatchEvent(new Event('canplay'))
  }
  seekComplete() {
    this.seeking = false
    this.readyState = 4
    this.dispatchEvent(new Event('seeked'))
  }
  play(): Promise<void> {
    this.plays++
    this.onPlay?.()
    if (this.failPlay) return Promise.reject(new Error('autoplay rejected'))
    if (this.delayPlay)
      return new Promise((resolve) => {
        this.deferredPlay = () => {
          this.paused = false
          resolve()
        }
      })
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.pauses++
    this.paused = true
  }
}

async function tickUntil(check: () => boolean) {
  const deadline = Date.now() + 1000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('fixture timed out')
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function fixture() {
  const primary = new FakeAudio(),
    candidate = new FakeAudio()
  primary.src = 'https://online/stream'
  primary.paused = false
  primary.setLiveTime(10)
  const controller = new AbortController()
  let current = true,
    commits = 0
  const intent: AudioHandoffIntent = { playing: true, volume: 0.7, muted: false, playbackRate: 1 }
  const run = (timeoutMs = 500) =>
    handoffAudioToCache({
      primary: primary as unknown as HTMLAudioElement,
      candidate: candidate as unknown as HTMLAudioElement,
      url: 'blob:cached-fixture',
      signal: controller.signal,
      isCurrent: () => current,
      getIntent: () => ({ ...intent }),
      commit: () => {
        assert.ok(candidate.readyState >= 2)
        assert.equal(candidate.seeking, false)
        assert.ok(Math.abs(candidate.currentTime - primary.currentTime) <= 0.12)
        commits++
        setActivePlaybackAudio(candidate as unknown as HTMLAudioElement)
      },
      timeoutMs,
    })
  return {
    primary,
    candidate,
    controller,
    intent,
    run,
    cancel() {
      current = false
      controller.abort()
    },
    get commits() {
      return commits
    },
  }
}

test('live stream stays untouched until candidate is freshly ready and seeked to latest position', async (t) => {
  const f = fixture()
  t.after(() => setActivePlaybackAudio(null))
  f.candidate.manualReady = true
  f.candidate.manualSeek = true
  const result = f.run()
  await tickUntil(() => f.candidate.src !== '')
  assert.equal(f.primary.src, 'https://online/stream')
  assert.equal(f.primary.pauses, 0)
  f.primary.setLiveTime(35)
  f.candidate.ready()
  await tickUntil(() => f.candidate.seeking)
  assert.equal(f.commits, 0)
  f.primary.setLiveTime(36)
  f.candidate.seekComplete()
  await tickUntil(() => f.candidate.currentTime === 36 && f.candidate.seeking)
  f.candidate.seekComplete()
  assert.equal(await result, true)
  assert.equal(f.commits, 1)
  assert.equal(f.primary.pauses, 1)
  assert.equal(
    f.primary.src,
    'https://online/stream',
    'source recycling happens only after the committed handoff'
  )
  assert.equal(getActivePlaybackAudio(), f.candidate)
})

test('latest pause, volume, mute and playback rate win over state captured before downloading', async (t) => {
  const f = fixture()
  t.after(() => setActivePlaybackAudio(null))
  f.candidate.manualReady = true
  const result = f.run()
  await tickUntil(() => f.candidate.src !== '')
  Object.assign(f.intent, { playing: false, volume: 0.23, muted: true, playbackRate: 1.25 })
  f.primary.pause()
  f.primary.setLiveTime(60)
  f.candidate.ready()
  assert.equal(await result, true)
  assert.equal(f.candidate.plays, 0)
  assert.equal(f.candidate.paused, true)
  assert.equal(f.candidate.volume, 0.23)
  assert.equal(f.candidate.muted, true)
  assert.equal(f.candidate.playbackRate, 1.25)
  assert.equal(f.candidate.currentTime, 60)
})

test('a pause during asynchronous play preparation cannot resume the user after commit', async (t) => {
  const f = fixture()
  t.after(() => setActivePlaybackAudio(null))
  f.candidate.delayPlay = true
  const result = f.run()
  await tickUntil(() => Boolean(f.candidate.deferredPlay))
  f.intent.playing = false
  f.primary.pause()
  f.candidate.deferredPlay!()
  assert.equal(await result, true)
  assert.equal(f.candidate.paused, true)
  assert.equal(f.primary.plays, 0)
})

test('candidate media failure and timeout leave the live primary source and owner intact', async (t) => {
  t.after(() => setActivePlaybackAudio(null))
  for (const fail of ['error', 'timeout']) {
    const f = fixture()
    setActivePlaybackAudio(f.primary as unknown as HTMLAudioElement)
    f.candidate.manualReady = true
    const result = f.run(20)
    await tickUntil(() => f.candidate.src !== '')
    if (fail === 'error') f.candidate.dispatchEvent(new Event('error'))
    assert.equal(await result, false)
    assert.equal(f.commits, 0)
    assert.equal(f.primary.src, 'https://online/stream')
    assert.equal(f.primary.paused, false)
    assert.equal(getActivePlaybackAudio(), f.primary)
    assert.equal(f.candidate.src, '')
  }
})

test('rejected candidate playback recovers a browser-interrupted primary without replacing its source', async () => {
  const f = fixture()
  f.candidate.failPlay = true
  f.candidate.onPlay = () => f.primary.pause()
  assert.equal(await f.run(), false)
  assert.equal(f.commits, 0)
  assert.equal(f.primary.src, 'https://online/stream')
  assert.equal(f.primary.paused, false)
  assert.equal(f.primary.plays, 1)
})

test('next-track cancellation and late candidate play callbacks cannot replace the new owner', async (t) => {
  const f = fixture()
  t.after(() => setActivePlaybackAudio(null))
  f.candidate.delayPlay = true
  const result = f.run()
  await tickUntil(() => Boolean(f.candidate.deferredPlay))
  f.cancel()
  assert.equal(await result, false)
  const next = new FakeAudio()
  setActivePlaybackAudio(next as unknown as HTMLAudioElement)
  f.candidate.deferredPlay!()
  await Promise.resolve()
  assert.equal(f.commits, 0)
  assert.equal(getActivePlaybackAudio(), next)
  assert.equal(f.primary.src, 'https://online/stream')
  assert.equal(f.candidate.src, '')
})

test('old physical element cleanup cannot clear a newer registered owner', () => {
  const first = new FakeAudio(),
    second = new FakeAudio()
  setActivePlaybackAudio(first as unknown as HTMLAudioElement)
  setActivePlaybackAudio(second as unknown as HTMLAudioElement)
  clearActivePlaybackAudio(first as unknown as HTMLAudioElement)
  assert.equal(getActivePlaybackAudio(), second)
  assert.equal(first.dataset.playbackOwner, undefined)
  assert.equal(second.dataset.playbackOwner, 'primary')
  clearActivePlaybackAudio(second as unknown as HTMLAudioElement)
  assert.equal(getActivePlaybackAudio(), null)
})

test('player uses only the existing two audio nodes and rebinds source-owned events after handoff', () => {
  const read = (name: string) => readFileSync(path.resolve(process.cwd(), 'src', name), 'utf8')
  const source = read('components/Player/AudioPlayer.tsx')
  assert.equal((source.match(/<audio /g) || []).length, 2)
  assert.match(source, /candidate: lease.audio/)
  assert.match(source, /audioRef.current = lease.audio/)
  assert.match(source, /secondaryAudioRef.current = primary/)
  assert.match(source, /setActivePlaybackAudio\(lease.audio\)/)
  assert.match(source, /effectActive && audioRef.current === audio/)
  assert.match(source, /audioOwnerVersion\]/)
  assert.doesNotMatch(source, /audio.src = blobUrl;\s*audio.load\(\);\s*await new Promise/)
  for (const name of [
    'hooks/usePlaybackPersistence.ts',
    'hooks/useRadioSync.ts',
    'components/Player/MorrorLyrics.tsx',
    'components/Player/LyricsView.tsx',
    'components/Player/VideoPlayer.tsx',
    'components/Player/FullscreenLyrics.tsx',
  ]) {
    const consumer = read(name)
    assert.match(consumer, /getActivePlaybackAudio\(\)/)
    assert.doesNotMatch(consumer, /document.querySelector\('audio'\)/)
  }
  const crossfade = read('hooks/useCrossfade.ts')
  assert.match(
    crossfade,
    /crossfadeActiveRef.current \|\| preloadedRef.current \|\| secondaryLoadingRef.current \|\| secondaryLeaseRef.current/
  )
  assert.match(crossfade, /secondaryLeaseRef.current\?\.abort\(\)/)
  assert.match(crossfade, /loadVersion !== secondaryLoadVersionRef.current/)
})
