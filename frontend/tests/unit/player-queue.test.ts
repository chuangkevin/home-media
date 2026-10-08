import assert from 'node:assert/strict'
import test from 'node:test'
import reducer, {
  addToQueue,
  playNext,
  setCurrentTime,
  setCurrentTrack,
  setIsPlaying,
  setPlaylist,
} from '../../src/store/playerSlice'
import type { Track } from '../../src/types/track.types'

const a: Track = {
  id: 'a',
  videoId: 'a',
  title: 'Song A',
  channel: 'Artist',
  thumbnail: '',
  duration: 90,
}
const b: Track = {
  id: 'b',
  videoId: 'b',
  title: 'Song B',
  channel: 'Artist',
  thumbnail: '',
  duration: 90,
}

function playingA() {
  let state = reducer(undefined, setPlaylist([a]))
  state = reducer(state, setCurrentTrack(a))
  state = reducer(state, setCurrentTime(17))
  return reducer(state, setIsPlaying(true))
}

test('adding a track keeps playback intact and makes it the next playable track', () => {
  const state = reducer(playingA(), addToQueue(b))
  assert.deepEqual(
    state.playlist.map((track) => track.videoId),
    ['a', 'b']
  )
  assert.equal(state.currentTrack?.videoId, 'a')
  assert.equal(state.currentTime, 17)
  assert.equal(state.currentIndex, 0)
  assert.equal(state.isPlaying, true)
  assert.equal(state.pendingTrack, null)
  assert.equal(reducer(state, playNext()).pendingTrack?.videoId, 'b')
})

test('repeated additions use video identity and do not duplicate or move tracks', () => {
  let state = reducer(playingA(), addToQueue(b))
  state = reducer(state, addToQueue({ ...b, id: 'another-result-id' }))
  state = reducer(state, addToQueue(a))
  assert.deepEqual(
    state.playlist.map((track) => track.videoId),
    ['a', 'b']
  )
  assert.equal(state.currentTrack?.videoId, 'a')
  assert.equal(state.currentTime, 17)
  assert.equal(state.pendingTrack, null)
})

test('adding to an idle queue does not start playback without a play action', () => {
  const state = reducer(undefined, addToQueue(b))
  assert.deepEqual(
    state.playlist.map((track) => track.videoId),
    ['b']
  )
  assert.equal(state.currentTrack, null)
  assert.equal(state.pendingTrack, null)
  assert.equal(state.isPlaying, false)
})

test('manual additions append after existing recommendations and remain reachable', () => {
  const c: Track = { ...a, id: 'c', videoId: 'c', title: 'Recommended C' }
  const d: Track = { ...a, id: 'd', videoId: 'd', title: 'Recommended D' }
  let state = reducer(playingA(), setPlaylist([a, c, d]))
  state = reducer(state, addToQueue(b))
  assert.deepEqual(
    state.playlist.map((track) => track.videoId),
    ['a', 'c', 'd', 'b']
  )
  assert.equal(reducer(state, playNext()).pendingTrack?.videoId, 'c')
  state = reducer(state, setCurrentTrack(d))
  assert.equal(reducer(state, playNext()).pendingTrack?.videoId, 'b')
})
