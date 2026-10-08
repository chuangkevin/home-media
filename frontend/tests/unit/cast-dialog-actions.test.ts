import assert from 'node:assert/strict'
import test from 'node:test'
import { configureStore } from '@reduxjs/toolkit'
import {
  startDraftCast,
  stopActiveCast,
  toggleDraftCastTarget,
} from '../../src/components/Cast/castDialogActions'
import casting, { setCastTargets, setIsConnected } from '../../src/store/castingSlice'
import player, { setCurrentTime, setCurrentTrack, setIsPlaying } from '../../src/store/playerSlice'
import type { Track } from '../../src/types/track.types'

const track: Track = {
  id: 'song-a',
  videoId: 'song-a',
  title: 'Song A',
  channel: 'Artist A',
  thumbnail: '',
  duration: 90,
}

function setup() {
  const store = configureStore({ reducer: { casting, player } })
  store.dispatch(setIsConnected(true))
  store.dispatch(setCurrentTrack(track))
  store.dispatch(setCurrentTime(23))
  store.dispatch(setIsPlaying(true))
  const starts: { targets: string[]; track: Track; position: number; playing: boolean }[] = []
  const stops: string[][] = []
  const transport = {
    startCast(targets: string[], selectedTrack: Track, position: number, playing: boolean) {
      starts.push({ targets: [...targets], track: selectedTrack, position, playing })
    },
    stopCast(targets: string[]) {
      // The command must be sent before clearing the active session.
      assert.deepEqual(targets, store.getState().casting.castTargets)
      assert.equal(store.getState().casting.isController, true)
      stops.push([...targets])
    },
  }
  return { store, transport, starts, stops }
}

test('editing or discarding device drafts never changes active cast targets', () => {
  const { store, starts, stops } = setup()
  let draft = toggleDraftCastTarget([], 'device-a', false)
  draft = toggleDraftCastTarget(draft, 'device-b', false)
  draft = toggleDraftCastTarget(draft, 'device-a', false)
  assert.deepEqual(draft, ['device-b'])
  assert.deepEqual(store.getState().casting.castTargets, [])
  draft = [] // The dialog discards its local draft on cancel/close.
  assert.deepEqual(draft, [])
  assert.equal(store.getState().casting.isController, false)
  assert.equal(starts.length, 0)
  assert.equal(stops.length, 0)
})

test('starting commits a snapshot of the draft and rejects repeated start actions', () => {
  const { store, transport, starts } = setup()
  const draft = ['device-a', 'device-b']
  assert.equal(startDraftCast(store, transport, draft), true)
  draft.pop()
  assert.deepEqual(store.getState().casting.castTargets, ['device-a', 'device-b'])
  assert.equal(store.getState().casting.isController, true)
  assert.deepEqual(starts, [
    { targets: ['device-a', 'device-b'], track, position: 23, playing: true },
  ])
  assert.equal(startDraftCast(store, transport, ['device-c']), false)
  assert.equal(starts.length, 1)
})

test('an attempted uncheck while casting cannot remove the device from the stop command', () => {
  const { store, transport, stops } = setup()
  let draft = ['device-a']
  startDraftCast(store, transport, draft)
  draft = toggleDraftCastTarget(draft, 'device-a', store.getState().casting.isController)
  assert.deepEqual(draft, ['device-a'])
  assert.deepEqual(store.getState().casting.castTargets, ['device-a'])
  assert.equal(stopActiveCast(store, transport), true)
  assert.deepEqual(stops, [['device-a']])
  assert.deepEqual(store.getState().casting.castTargets, [])
  assert.equal(store.getState().casting.isController, false)
  assert.equal(stopActiveCast(store, transport), false)
  assert.equal(stops.length, 1)
})

test('stop uses the latest active targets even when a dialog had an older draft', () => {
  const { store, transport, stops } = setup()
  startDraftCast(store, transport, ['device-a'])
  store.dispatch(setCastTargets(['device-b']))
  stopActiveCast(store, transport)
  assert.deepEqual(stops, [['device-b']])
})

test('start checks current connection, track and nonempty draft before sending', () => {
  const { store, transport, starts } = setup()
  store.dispatch(setIsConnected(false))
  assert.equal(startDraftCast(store, transport, ['device-a']), false)
  store.dispatch(setIsConnected(true))
  store.dispatch(setCurrentTrack(null))
  assert.equal(startDraftCast(store, transport, ['device-a']), false)
  store.dispatch(setCurrentTrack(track))
  assert.equal(startDraftCast(store, transport, []), false)
  assert.equal(starts.length, 0)
  assert.deepEqual(store.getState().casting.castTargets, [])
})
