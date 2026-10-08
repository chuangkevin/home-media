let activeAudio: HTMLAudioElement | null = null
const listeners = new Set<() => void>()

/** One audible owner for the existing pair of audio elements. All visual,
 * persistence and radio consumers must read this owner after a cache handoff. */
export function setActivePlaybackAudio(audio: HTMLAudioElement | null): void {
  if (activeAudio === audio) return
  if (activeAudio && activeAudio !== audio) delete activeAudio.dataset.playbackOwner
  activeAudio = audio
  if (audio) audio.dataset.playbackOwner = 'primary'
  listeners.forEach((listener) => listener())
}

export function subscribeActivePlaybackAudio(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function clearActivePlaybackAudio(expected: HTMLAudioElement | null): void {
  if (activeAudio === expected) setActivePlaybackAudio(null)
}

export function getActivePlaybackAudio(): HTMLAudioElement | null {
  if (activeAudio && activeAudio.isConnected !== false) return activeAudio
  if (typeof document === 'undefined') return null
  return (
    document.querySelector<HTMLAudioElement>('audio[data-playback-owner="primary"]') ??
    document.querySelector<HTMLAudioElement>('audio')
  )
}
