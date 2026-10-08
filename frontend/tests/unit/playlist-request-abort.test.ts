import assert from 'node:assert/strict'
import test from 'node:test'
import { configureStore } from '@reduxjs/toolkit'
import apiService, { type PlaylistWithTracks } from '../../src/services/api.service'
import playlists, { fetchPlaylist } from '../../src/store/playlistSlice'

test('aborting a page request prevents its late response from replacing a newer playlist', async (t) => {
  let resolveOld!: (playlist: PlaylistWithTracks) => void
  const oldResponse = new Promise<PlaylistWithTracks>((resolve) => {
    resolveOld = resolve
  })
  const playlist = (id: string): PlaylistWithTracks => ({
    id,
    name: id,
    description: '',
    trackCount: 0,
    createdAt: 0,
    updatedAt: 0,
    tracks: [],
  })
  t.mock.method(apiService, 'getPlaylist', (id: string) =>
    id === 'old' ? oldResponse : Promise.resolve(playlist(id))
  )
  const store = configureStore({ reducer: { playlists } })
  const oldRequest = store.dispatch(fetchPlaylist('old'))
  oldRequest.abort()
  const aborted = await oldRequest
  if (!fetchPlaylist.rejected.match(aborted)) throw new Error('Expected the old request to reject')
  assert.equal(aborted.meta.aborted, true)
  await store.dispatch(fetchPlaylist('new')).unwrap()
  resolveOld(playlist('old'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(store.getState().playlists.currentPlaylist?.id, 'new')
})
