import assert from 'node:assert/strict'
import test from 'node:test'
import { configureStore } from '@reduxjs/toolkit'
import { createPlaylistPlaybackGuard } from '../../src/components/Playlist/playlistPlaybackGuard'
import player, {
  addToQueue,
  cancelPendingTrack,
  clearSeekTarget,
  confirmPendingTrack,
  playNow,
  playPrevious,
  seekTo,
  setCurrentTime,
  setCurrentTrack,
  setIsPlaying,
  setPendingTrack,
  setPlaylist,
  setVolume,
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
const b: Track = { ...a, id: 'b', videoId: 'b', title: 'Song B' }
const requested: Track = { ...a, id: 'playlist', videoId: 'playlist', title: 'Playlist song' }

function playingA() {
  const store = configureStore({ reducer: { player } })
  store.dispatch(setPlaylist([a]))
  store.dispatch(setCurrentTrack(a))
  store.dispatch(setIsPlaying(true))
  return store
}

function deferredPlaylist() {
  let resolve!: (tracks: Track[]) => void
  const result = new Promise<Track[]>((done) => {
    resolve = done
  })
  return { result, resolve }
}

test('a slow play-all result cannot replace a later song selection', async () => {
  const store = playingA()
  const guard = createPlaylistPlaybackGuard(store)
  const playlist = deferredPlaylist()
  const completed = playlist.result.then((tracks) => {
    if (guard.canPlay()) {
      store.dispatch(setPlaylist(tracks))
      store.dispatch(setPendingTrack(tracks[0]))
    }
    guard.dispose()
  })
  store.dispatch(playNow(b))
  store.dispatch(confirmPendingTrack())
  playlist.resolve([requested])
  await completed
  assert.equal(store.getState().player.currentTrack?.videoId, 'b')
  assert.equal(store.getState().player.pendingTrack, null)
  assert.deepEqual(
    store.getState().player.playlist.map((track) => track.videoId),
    ['a', 'b']
  )
})

test('progress, volume and queue additions preserve the pending play-all choice', () => {
  const store = playingA()
  const guard = createPlaylistPlaybackGuard(store)
  store.dispatch(setCurrentTime(25))
  store.dispatch(setVolume(0.3))
  store.dispatch(addToQueue(b))
  assert.equal(guard.canPlay(), true)
  assert.equal(store.getState().player.currentTime, 25)
  assert.equal(store.getState().player.isPlaying, true)
  guard.dispose()
})

test('a temporary pending selection invalidates the request even after returning to A', () => {
  const store = playingA()
  const guard = createPlaylistPlaybackGuard(store)
  store.dispatch(setPendingTrack(b))
  store.dispatch(cancelPendingTrack())
  assert.equal(store.getState().player.currentTrack?.videoId, 'a')
  assert.equal(store.getState().player.pendingTrack, null)
  assert.equal(guard.canPlay(), false)
  guard.dispose()
})

test('pausing and resuming or replaying the same song still invalidates old play-all', () => {
  const store = playingA()
  const pauseGuard = createPlaylistPlaybackGuard(store)
  store.dispatch(setIsPlaying(false))
  store.dispatch(setIsPlaying(true))
  assert.equal(pauseGuard.canPlay(), false)
  pauseGuard.dispose()
  const replayGuard = createPlaylistPlaybackGuard(store)
  store.dispatch(playNow(a))
  store.dispatch(confirmPendingTrack())
  assert.equal(replayGuard.canPlay(), false)
  replayGuard.dispose()
})

test('cancelling on page exit prevents a delayed result without stopping current audio', async () => {
  const store = playingA()
  const guard = createPlaylistPlaybackGuard(store)
  const playlist = deferredPlaylist()
  const completed = playlist.result.then(() => {
    if (guard.canPlay()) store.dispatch(setPendingTrack(requested))
    guard.dispose()
  })
  guard.cancel()
  store.dispatch(setCurrentTime(26))
  playlist.resolve([requested])
  await completed
  assert.equal(store.getState().player.currentTrack?.videoId, 'a')
  assert.equal(store.getState().player.pendingTrack, null)
  assert.equal(store.getState().player.isPlaying, true)
  assert.equal(store.getState().player.currentTime, 26)
})

test('restarting the current song prevents a slow play-all response from overriding it', async () => {
  const store = playingA()
  store.dispatch(setCurrentTime(17))
  const guard = createPlaylistPlaybackGuard(store)
  const playlist = deferredPlaylist()
  const completed = playlist.result.then((tracks) => {
    if (guard.canPlay()) {
      store.dispatch(setPlaylist(tracks))
      store.dispatch(setPendingTrack(tracks[0]))
    }
    guard.dispose()
  })
  store.dispatch(playPrevious())
  store.dispatch(clearSeekTarget())
  playlist.resolve([requested])
  await completed
  assert.equal(store.getState().player.currentTrack?.videoId, 'a')
  assert.equal(store.getState().player.currentTime, 0)
  assert.equal(store.getState().player.pendingTrack, null)
  assert.deepEqual(
    store.getState().player.playlist.map((item) => item.videoId),
    ['a']
  )
})

test('a new seek invalidates play-all, while completing an earlier seek and time updates do not', () => {
  const store = playingA()
  store.dispatch(seekTo(12))
  const guard = createPlaylistPlaybackGuard(store)
  store.dispatch(clearSeekTarget())
  store.dispatch(setCurrentTime(13))
  assert.equal(guard.canPlay(), true)

  // Seeking to the same earlier position is still a new explicit user action.
  store.dispatch(seekTo(12))
  store.dispatch(clearSeekTarget())
  store.dispatch(setCurrentTime(14))
  assert.equal(guard.canPlay(), false)
  guard.dispose()
})
