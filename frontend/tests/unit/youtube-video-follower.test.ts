import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { setActivePlaybackAudio } from '../../src/services/active-audio'
import { createYouTubeVideoFollower } from '../../src/services/youtube-video-follower'

function fixture(t: any) {
  let current = true,
    playing = false,
    now = 0
  const audio = {
    dataset: {},
    isConnected: true,
    currentTime: 12,
    paused: true,
    seeking: false,
    readyState: 4,
  }
  const calls: Array<[string, number?]> = []
  const player = {
    state: -1,
    time: 0,
    mute() {
      calls.push(['mute'])
    },
    playVideo() {
      calls.push(['play'])
    },
    pauseVideo() {
      calls.push(['pause'])
    },
    seekTo(time: number) {
      calls.push(['seek', time])
      this.time = time
    },
    getCurrentTime() {
      return this.time
    },
    getPlayerState() {
      return this.state
    },
  }
  let activePlayer: any = player
  setActivePlaybackAudio(audio as any)
  t.after(() => setActivePlaybackAudio(null))
  const follower = createYouTubeVideoFollower({
    isCurrent: () => current,
    getPlayer: () => activePlayer,
    getPlaying: () => playing,
    now: () => now,
  })
  return {
    audio,
    player,
    calls,
    follower,
    setPlaying(value: boolean) {
      playing = value
      audio.paused = !value
    },
    advance(ms: number) {
      now += ms
    },
    close() {
      current = false
    },
    replace() {
      activePlayer = {}
    },
    state(state: number) {
      player.state = state
      follower.onStateChange({ target: player, data: state })
    },
  }
}

test('delayed ready honors latest pause and mutes before any seek or playback command', (t) => {
  const f = fixture(t)
  f.setPlaying(true)
  f.setPlaying(false)
  assert.equal(f.follower.onReady({ target: f.player }), true)
  assert.deepEqual(f.calls, [['mute']])
  f.state(1)
  assert.equal(f.calls.at(-1)?.[0], 'pause')
})

test('audio readiness and latest play intent govern startup without repeated SDK play commands', (t) => {
  const f = fixture(t)
  f.setPlaying(true)
  f.audio.readyState = 0
  f.follower.onReady({ target: f.player })
  assert.deepEqual(f.calls, [['mute']])
  f.audio.readyState = 4
  for (let i = 0; i < 10; i++) f.follower.tick()
  assert.equal(f.calls.filter(([name]) => name === 'play').length, 1)
  f.state(1)
  f.setPlaying(false)
  f.follower.tick()
  f.follower.tick()
  assert.equal(f.calls.filter(([name]) => name === 'pause').length, 1)
})

test('closed, replacement and disposed generations ignore late ready/state/tick callbacks', (t) => {
  for (const stop of ['close', 'replace', 'dispose'] as const) {
    const f = fixture(t)
    f.setPlaying(true)
    if (stop === 'dispose') f.follower.dispose()
    else f[stop]()
    assert.equal(f.follower.onReady({ target: f.player }), false)
    f.state(1)
    f.follower.tick()
    assert.deepEqual(f.calls, [])
  }
})

test('buffering cannot cause repeated follower seeks; latest position is coalesced and rate-limited', (t) => {
  const f = fixture(t)
  f.setPlaying(true)
  f.follower.onReady({ target: f.player })
  f.state(3)
  for (let i = 0; i < 100; i++) {
    f.audio.currentTime++
    f.advance(10)
    f.follower.tick()
    f.state(3)
  }
  assert.equal(f.calls.filter(([name]) => name === 'seek').length, 1)
  f.state(1)
  assert.deepEqual(
    f.calls.filter(([name]) => name === 'seek'),
    [
      ['seek', 12],
      ['seek', 112],
    ]
  )
  f.audio.currentTime = 113
  f.follower.tick()
  assert.equal(f.calls.filter(([name]) => name === 'seek').length, 2)
  f.advance(1000)
  f.follower.tick()
  assert.equal(f.calls.filter(([name]) => name === 'seek').length, 3)
})

test('programmatic seek guard is installed before a synchronous SDK buffering callback', (t) => {
  const f = fixture(t)
  f.setPlaying(true)
  f.player.seekTo = (time) => {
    f.calls.push(['seek', time])
    f.state(3)
  }
  f.follower.onReady({ target: f.player })
  assert.equal(f.calls.filter(([name]) => name === 'seek').length, 1)
})

test('active audio ownership changes and valid zero positions replace captured track time', (t) => {
  const f = fixture(t)
  f.player.state = 2
  f.follower.onReady({ target: f.player })
  const next = { ...f.audio, dataset: {}, currentTime: 0 }
  setActivePlaybackAudio(next as any)
  f.advance(1000)
  f.follower.tick()
  assert.deepEqual(f.calls.at(-1), ['seek', 0])
  next.seeking = true
  next.currentTime = 50
  f.advance(1000)
  f.follower.tick()
  assert.deepEqual(f.calls.at(-1), ['seek', 0])
  next.seeking = false
  f.follower.tick()
  assert.deepEqual(f.calls.at(-1), ['seek', 50])
})

test('both iframe views share muted generation-owned initialization and one retry path', () => {
  const read = (name: string) =>
    readFileSync(path.resolve(process.cwd(), 'src/components/Player', name), 'utf8')
  const regular = read('VideoPlayer.tsx'),
    full = read('FullscreenLyrics.tsx')
  for (const source of [regular, full]) {
    assert.match(source, /createYouTubeVideoFollower/)
    assert.match(source, /autoplay: 0/)
    assert.match(source, /mute: 1/)
    assert.match(source, /follower\.onReady\(event\)/)
    assert.match(source, /follower\.dispose\(\)/)
  }
  assert.equal((regular.match(/new window.YT.Player/g) || []).length, 1)
  assert.match(regular, /setRetryVersion\(version => version \+ 1\)/)
  assert.doesNotMatch(regular, /event\.target\.playVideo\(\)/)
  assert.doesNotMatch(full, /playerRef\.current\.seekTo\(/)
})

test('actual fullscreen production callbacks honor paused ready, valid zero and close/track generation', (t) => {
  const f = fixture(t)
  f.audio.currentTime = 0
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/components/Player/FullscreenLyrics.tsx'),
    'utf8'
  )
  const start = source.indexOf(
    '  useEffect(() => {',
    source.indexOf('// 初始化或銷毀 YouTube 播放器')
  )
  const end = source.indexOf('  }, [open, viewMode, showCachedVideo, track.videoId]);', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const body = source.slice(start + '  useEffect(() => {'.length, end)
  const code =
    ts.transpileModule('const effect = () => {' + body + '};', {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText + ';return effect'
  const players: any[] = [],
    ready: boolean[] = []
  class Player {
    options: any
    calls: any[] = []
    destroyed = false
    constructor(_node: any, options: any) {
      this.options = options
      players.push(this)
    }
    mute() {
      this.calls.push(['mute'])
    }
    getPlayerState() {
      return -1
    }
    getCurrentTime() {
      return 0
    }
    seekTo(time: number) {
      this.calls.push(['seek', time])
    }
    playVideo() {
      this.calls.push(['play'])
    }
    pauseVideo() {
      this.calls.push(['pause'])
    }
    destroy() {
      this.destroyed = true
    }
  }
  const context: Record<string, any> = {
    open: true,
    viewMode: 'video',
    showCachedVideo: false,
    videoContainerRef: { current: {} },
    playerRef: { current: null },
    videoTimeSyncRef: { current: null },
    iframeGenerationRef: { current: 0 },
    iframeFollowerRef: { current: null },
    iframePlayingRef: { current: false },
    isOpenRef: { current: true },
    viewModeRef: { current: 'video' },
    activeTrackVideoIdRef: { current: 'fixture1234' },
    track: { videoId: 'fixture1234' },
    currentTime: 99,
    window: { YT: { Player }, location: { origin: 'https://fixture.local' } },
    setIframeAutoplayBlocked: () => {},
    setVideoReady: (value: boolean) => ready.push(value),
    createYouTubeVideoFollower,
    getActivePlaybackAudio: () => f.audio,
    console: { log() {}, error() {} },
    clearInterval,
  }
  const effect = new Function(...Object.keys(context), code)(...Object.values(context))
  const cleanup = effect(),
    player = players[0]
  assert.equal(player.options.playerVars.autoplay, 0)
  assert.equal(player.options.playerVars.mute, 1)
  assert.equal(
    player.options.playerVars.start,
    0,
    'live zero never falls back to stale Redux position99'
  )
  player.options.events.onReady({ target: player })
  assert.deepEqual(player.calls, [['mute']])
  assert.equal(ready.at(-1), true)
  context.activeTrackVideoIdRef.current = 'replacement'
  player.options.events.onReady({ target: player })
  player.options.events.onStateChange({ target: player, data: 1 })
  assert.deepEqual(player.calls, [['mute']])
  cleanup()
  player.options.events.onReady({ target: player })
  assert.deepEqual(player.calls, [['mute']])
  assert.equal(player.destroyed, true)
})

test('unacknowledged or autoplay-blocked play retries only on a new explicit gesture or intent', (t) => {
  const f = fixture(t)
  f.setPlaying(true)
  f.follower.onReady({ target: f.player })
  for (let i = 0; i < 20; i++) {
    f.advance(1000)
    f.audio.currentTime++
    f.follower.tick()
  }
  assert.equal(f.calls.filter(([name]) => name === 'play').length, 1)
  assert.equal(
    f.calls.filter(([name]) => name === 'seek').length,
    1,
    'seekTo must not implicitly retry unacknowledged playback'
  )
  f.follower.onAutoplayBlocked({ target: f.player })
  for (let i = 0; i < 20; i++) f.follower.tick()
  assert.equal(f.calls.filter(([name]) => name === 'play').length, 1)
  f.follower.retryOnGesture()
  assert.equal(f.calls.filter(([name]) => name === 'play').length, 2)
  for (let i = 0; i < 20; i++) f.follower.tick()
  assert.equal(f.calls.filter(([name]) => name === 'play').length, 2)
  f.state(1)
  assert.equal(
    f.calls.filter(([name]) => name === 'seek').length,
    2,
    'PLAYING acknowledgement re-enables bounded follow sync'
  )
  f.state(5)
  const beforeNewIntent = f.calls.filter(([name]) => name === 'play').length
  f.follower.onAutoplayBlocked({ target: f.player })
  f.setPlaying(false)
  f.follower.tick()
  f.setPlaying(true)
  f.follower.tick()
  assert.equal(f.calls.filter(([name]) => name === 'play').length, beforeNewIntent + 1)
})

test('actual fullscreen manual-seek effect respects buffering and completed paused audio seeks', (t) => {
  const f = fixture(t)
  f.player.state = 2
  f.follower.onReady({ target: f.player })
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/components/Player/FullscreenLyrics.tsx'),
    'utf8'
  )
  const start = source.indexOf('  useEffect(() => {', source.indexOf('// 處理影片 seek 操作'))
  const end = source.indexOf('  }, [seekTarget, videoReady, viewMode, showCachedVideo]);', start)
  const body = source.slice(start + '  useEffect(() => {'.length, end)
  const code =
    ts.transpileModule('const effect = () => {' + body + '};', {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText + ';return effect'
  const context = {
    seekTarget: 42,
    viewMode: 'video',
    showCachedVideo: false,
    videoReady: true,
    cachedVideoRef: { current: null },
    iframeFollowerRef: { current: f.follower },
    playerRef: { current: f.player },
    seekFollowingVideo: () => assert.fail('not native path'),
    console: { error() {} },
  }
  const effect = new Function(...Object.keys(context), code)(...Object.values(context))
  f.state(3)
  f.audio.currentTime = 42
  f.advance(1000)
  effect()
  assert.equal(f.calls.filter(([name]) => name === 'seek').length, 1)
  f.audio.seeking = true
  f.state(2)
  effect()
  assert.equal(f.calls.filter(([name]) => name === 'seek').length, 1)
  f.audio.seeking = false
  effect()
  assert.deepEqual(f.calls.at(-1), ['seek', 42])
  assert.equal(f.calls.filter(([name]) => name === 'play').length, 0)
})
