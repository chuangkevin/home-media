import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  claimVideoCachePolling,
  hasVideoCachePollingExpired,
  isVideoCacheProducerFailure,
  VIDEO_CACHE_POLL_MAX_DURATION_MS,
} from '../../src/services/video-cache-polling'

test('closing a poll releases the same-video claim so reopening can restart it', () => {
  const ref = { current: null as string | null }
  const releaseFirst = claimVideoCachePolling(ref, 'same-video')

  assert.equal(typeof releaseFirst, 'function')
  assert.equal(claimVideoCachePolling(ref, 'same-video'), null)

  releaseFirst?.()
  const releaseSecond = claimVideoCachePolling(ref, 'same-video')
  assert.equal(typeof releaseSecond, 'function')

  // A stale cleanup must not release a newer poll's claim.
  releaseFirst?.()
  assert.equal(claimVideoCachePolling(ref, 'same-video'), null)
  releaseSecond?.()
  assert.equal(ref.current, null)
})

test('an accepted request with no cached or active producer is a failed producer', () => {
  assert.equal(isVideoCacheProducerFailure({ cached: false, downloading: false }, true), true)
  assert.equal(
    isVideoCacheProducerFailure({ cached: false, downloading: false }, false),
    false,
    'an idle server before this client has an accepted request is not a failure'
  )
  assert.equal(isVideoCacheProducerFailure({ cached: false, downloading: true }, true), false)
  assert.equal(isVideoCacheProducerFailure({ cached: true, downloading: false }, true), false)
})

test('slow video downloads remain pollable past 180s and the server deadline', () => {
  assert.equal(VIDEO_CACHE_POLL_MAX_DURATION_MS, 330_000)
  assert.equal(hasVideoCachePollingExpired(180_000), false)
  assert.equal(hasVideoCachePollingExpired(300_000), false)
  assert.equal(hasVideoCachePollingExpired(329_999), false)
  assert.equal(hasVideoCachePollingExpired(330_000), true)
})

test('video-cache polling is independent of view-mode changes', () => {
  const componentPath = path.resolve(process.cwd(), 'src/components/Player/FullscreenLyrics.tsx')
  const source = readFileSync(componentPath, 'utf8')
  const start = source.indexOf('// 影片快取：Drawer 開啟就開始下載')
  const end = source.indexOf('// 換歌時才重設影片快取狀態', start)

  assert.notEqual(start, -1, 'expected video-cache polling effect')
  assert.notEqual(end, -1, 'expected video-cache state reset effect')

  const pollingEffect = source.slice(start, end)
  assert.match(pollingEffect, /\},\s*\[open,\s*videoId\]\);/)
  assert.doesNotMatch(pollingEffect, /viewMode/)
})

test('retry and playlist drag targets retain at least a 44px hit area', () => {
  const frontendRoot = process.cwd()
  const fullscreenSource = readFileSync(
    path.resolve(frontendRoot, 'src/components/Player/FullscreenLyrics.tsx'),
    'utf8'
  )
  const mirrorSource = readFileSync(
    path.resolve(frontendRoot, 'src/components/Player/MorrorLyrics.tsx'),
    'utf8'
  )

  const fullscreenRetryStart = fullscreenSource.indexOf('label="重試翻譯"')
  const fullscreenRetryEnd = fullscreenSource.indexOf('/>', fullscreenRetryStart)
  const fullscreenRetry = fullscreenSource.slice(fullscreenRetryStart, fullscreenRetryEnd)
  assert.match(fullscreenRetry, /minHeight:\s*44/)

  const mirrorRetryStart = mirrorSource.indexOf('label="重試翻譯"')
  const mirrorRetryEnd = mirrorSource.indexOf('/>', mirrorRetryStart)
  const mirrorRetry = mirrorSource.slice(mirrorRetryStart, mirrorRetryEnd)
  assert.match(mirrorRetry, /minHeight:\s*44/)

  const dragHandleStart = fullscreenSource.indexOf('...dragProvided.dragHandleProps')
  const dragHandleEnd = fullscreenSource.indexOf('</Box>', dragHandleStart)
  const dragHandle = fullscreenSource.slice(dragHandleStart, dragHandleEnd)
  assert.match(dragHandle, /width:\s*44/)
  assert.match(dragHandle, /minHeight:\s*44/)
})
