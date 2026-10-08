import type { RootState } from '../../store'

type PlaybackState = Pick<
  RootState['player'],
  'currentTrack' | 'pendingTrack' | 'autoQueueSeedVersion' | 'isPlaying' | 'seekTarget'
>

interface PlaybackStore {
  getState: () => { player: PlaybackState }
  subscribe: (listener: () => void) => () => void
}

// A slow playlist response must not replace a playback choice made while it loads.
// Subscribe so a switch away and back is still observed; elapsed time and queue
// additions are intentionally ignored and never interrupt continuous playback.
export function createPlaylistPlaybackGuard(store: PlaybackStore) {
  const initial = store.getState().player
  let previousSeekTarget = initial.seekTarget
  let valid = true
  const unsubscribe = store.subscribe(() => {
    const current = store.getState().player
    // Consuming an earlier seek clears its target; only a new non-null target
    // is a newer playback choice. Timeupdate actions never change this field.
    const hasNewSeek = current.seekTarget !== null && current.seekTarget !== previousSeekTarget
    previousSeekTarget = current.seekTarget
    if (
      current.currentTrack?.videoId !== initial.currentTrack?.videoId ||
      current.pendingTrack?.videoId !== initial.pendingTrack?.videoId ||
      current.autoQueueSeedVersion !== initial.autoQueueSeedVersion ||
      current.isPlaying !== initial.isPlaying ||
      hasNewSeek
    ) {
      valid = false
    }
  })
  return {
    canPlay: () => valid,
    cancel: () => {
      valid = false
      unsubscribe()
    },
    dispose: unsubscribe,
  }
}
