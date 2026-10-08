import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  seekFollowingVideo,
  isFollowingVideoSeek,
  finishFollowingVideoSeek,
} from '../../src/services/video-follow-seek'

class FakeVideo extends EventTarget {
  private time = 0
  seeking = false
  writes = 0
  queued: Array<() => void> = []
  constructor(private readonly synchronous = true) {
    super()
  }
  get currentTime() {
    return this.time
  }
  set currentTime(value: number) {
    this.time = value
    this.seeking = true
    this.writes++
    const emit = () => this.dispatchEvent(new Event('seeking'))
    if (this.synchronous) emit()
    else this.queued.push(emit)
  }
  flush() {
    this.queued.splice(0).forEach((emit) => emit())
  }
  finish() {
    this.seeking = false
    this.dispatchEvent(new Event('seeked'))
  }
}

test('legacy cached-video seek echo reproduces an unbounded audio/video feedback loop', () => {
  const video = new FakeVideo()
  let audioSeeks = 0
  video.addEventListener('seeking', () => {
    // Old onSeeking -> Redux seekTo -> audio seek -> video seekTarget effect.
    audioSeeks++
    if (audioSeeks < 50) video.currentTime = video.currentTime
  })
  video.currentTime = 2
  assert.equal(audioSeeks, 50, 'fixture stops the legacy loop at a safety cap')
})

for (const synchronous of [true, false]) {
  test(`follower seeks never echo into audio with ${synchronous ? 'synchronous' : 'queued'} native events`, () => {
    const video = new FakeVideo(synchronous)
    let audioSeeks = 0
    video.addEventListener('seeking', () => {
      if (isFollowingVideoSeek(video)) return
      audioSeeks++
      seekFollowingVideo(video, video.currentTime)
    })
    video.addEventListener('seeked', () => finishFollowingVideoSeek(video))
    for (const time of [2, 5, 9]) {
      assert.equal(seekFollowingVideo(video, time), true)
      video.flush()
      video.finish()
    }
    assert.equal(video.writes, 3)
    assert.equal(audioSeeks, 0)
    assert.equal(seekFollowingVideo(video, 9.02), false)
    video.currentTime = 30 // Real native-control user scrub.
    video.flush()
    assert.equal(audioSeeks, 1)
    video.finish()
    assert.equal(isFollowingVideoSeek(video), false)
  })
}

test('a delayed old seeked event cannot clear a newer programmatic seek marker', () => {
  const video = new FakeVideo(false)
  seekFollowingVideo(video, 2)
  seekFollowingVideo(video, 4)
  video.dispatchEvent(new Event('seeked'))
  finishFollowingVideoSeek(video)
  assert.equal(isFollowingVideoSeek(video), true)
  video.flush()
  video.finish()
  finishFollowingVideoSeek(video)
  assert.equal(isFollowingVideoSeek(video), false)
})

test('a real user target supersedes a pending follower target without leaking across elements', () => {
  const oldVideo = new FakeVideo(false)
  const newVideo = new FakeVideo(false)
  seekFollowingVideo(oldVideo, 2)
  oldVideo.currentTime = 40
  assert.equal(isFollowingVideoSeek(oldVideo), false)
  assert.equal(isFollowingVideoSeek(newVideo), false)
  seekFollowingVideo(newVideo, 10)
  assert.equal(isFollowingVideoSeek(newVideo), true)
  assert.equal(isFollowingVideoSeek(oldVideo), false)
})

test('invalid targets and throwing media setters do not leave follower markers', () => {
  const video = new FakeVideo()
  for (const time of [NaN, Infinity, -1]) assert.equal(seekFollowingVideo(video, time), false)
  const broken = {
    seeking: false,
    get currentTime() {
      return 0
    },
    set currentTime(_time: number) {
      throw new Error('Not ready')
    },
  }
  assert.throws(() => seekFollowingVideo(broken, 10), /Not ready/)
  assert.equal(isFollowingVideoSeek(broken), false)
})

test('every cached-video alignment uses the follower guard; loading and stale handlers cannot seek audio', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'src/components/Player/FullscreenLyrics.tsx'),
    'utf8'
  )
  assert.doesNotMatch(source, /(?:videoEl|ve|cachedVideoRef\.current)\.currentTime\s*=/)
  assert.equal((source.match(/seekFollowingVideo\(/g) || []).length, 5)
  assert.match(
    source,
    /videoEl.readyState < 2 \|\| audioEl.readyState < 2 \|\| videoEl.seeking \|\| audioEl.seeking/
  )
  const start = source.indexOf('onSeeking={(e) => {')
  const end = source.indexOf('onPause=', start)
  const callbacks = source.slice(start, end)
  assert.match(callbacks, /cachedVideoRef.current !== videoEl/)
  assert.match(callbacks, /!isOpenRef.current/)
  assert.match(callbacks, /viewModeRef.current !== 'video'/)
  assert.match(callbacks, /activeTrackVideoIdRef.current !== track.videoId/)
  assert.match(callbacks, /isFollowingVideoSeek\(videoEl\)/)
  assert.match(callbacks, /dispatch\(seekTo\(videoEl.currentTime\)\)/)
  assert.match(callbacks, /finishFollowingVideoSeek\(videoEl\)/)
  assert.doesNotMatch(callbacks, /setTimeout/)
})
