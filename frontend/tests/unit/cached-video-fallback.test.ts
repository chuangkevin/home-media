import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  shouldUseCachedVideo,
  transitionCachedVideoFallback,
} from '../../src/services/cached-video-fallback'

test('cached video failure falls back only for the current open track and resets on track change', () => {
  let failedVideoId: string | null = null

  failedVideoId = transitionCachedVideoFallback(failedVideoId, {
    type: 'cache-error',
    error: { videoId: 'track-a', activeVideoId: 'track-a', isOpen: true },
  })
  assert.equal(failedVideoId, 'track-a')
  assert.equal(shouldUseCachedVideo(true, 'track-a', 'track-a', failedVideoId), false)
  assert.equal(shouldUseCachedVideo(true, 'track-b', 'track-b', failedVideoId), true)

  failedVideoId = transitionCachedVideoFallback(failedVideoId, { type: 'track-change' })
  assert.equal(failedVideoId, null)
  assert.equal(shouldUseCachedVideo(true, 'track-b', 'track-b', failedVideoId), true)
})

test('closed or stale media callbacks are ignored; retry is explicit and track-scoped', () => {
  assert.equal(
    transitionCachedVideoFallback(null, {
      type: 'cache-error',
      error: { videoId: 'track-a', activeVideoId: 'track-a', isOpen: false },
    }),
    null
  )
  assert.equal(
    transitionCachedVideoFallback(null, {
      type: 'cache-error',
      error: { videoId: 'track-a', activeVideoId: 'track-b', isOpen: true },
    }),
    null
  )

  assert.equal(
    transitionCachedVideoFallback('track-a', { type: 'cache-retry', videoId: 'track-b' }),
    'track-a'
  )
  assert.equal(
    transitionCachedVideoFallback('track-a', { type: 'cache-retry', videoId: 'track-a' }),
    null
  )
})

test('cached-video error handler leaves audio state alone and iframe fallback resyncs to live audio', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/components/Player/FullscreenLyrics.tsx'),
    'utf8'
  )
  const cachedVideoStart = source.indexOf('<video\n            key={`cached-video-')
  const errorStart = source.indexOf('onError={(event) => {', cachedVideoStart)
  const errorEnd = source.indexOf('onSeeking={(e) => {', errorStart)
  const handler = source.slice(errorStart, errorEnd)
  const playerEffectStart = source.indexOf('// 初始化或銷毀 YouTube 播放器')
  const playerEffectEnd = source.indexOf('// 同步 iframe 位置到 audio element', playerEffectStart)
  const playerEffect = source.slice(playerEffectStart, playerEffectEnd)

  assert.notEqual(cachedVideoStart, -1, 'expected cached HTML video element')
  assert.notEqual(errorStart, -1, 'expected cached HTML video error handling')
  assert.match(handler, /cachedVideoRef\.current !== event\.currentTarget/)
  assert.match(handler, /isOpenRef\.current/)
  assert.match(handler, /activeTrackVideoIdRef\.current !== videoId/)
  assert.doesNotMatch(handler, /querySelector|audioEl|dispatch\(|setIsPlaying/)

  assert.match(playerEffect, /showCachedVideo/)
  assert.match(playerEffect, /startTime = Math\.floor\(audioEl\?\.currentTime \?\? currentTime\)/)
  assert.match(playerEffect, /follower\.onReady\(event\)/)
  assert.match(source, /\[open, viewMode, showCachedVideo, track\.videoId\]/)
})
