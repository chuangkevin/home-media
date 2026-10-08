export interface CachedVideoFallbackError {
  videoId: string
  activeVideoId: string
  isOpen: boolean
}

/**
 * Keep an HTML5 cache playback error scoped to the current open track. A late
 * media event from a closed drawer or a previous track must not replace its UI.
 */
export function transitionCachedVideoFallback(
  failedVideoId: string | null,
  event:
    | { type: 'track-change' }
    | { type: 'cache-retry'; videoId: string }
    | { type: 'cache-error'; error: CachedVideoFallbackError }
): string | null {
  if (event.type === 'track-change') return null
  if (event.type === 'cache-retry') {
    return failedVideoId === event.videoId ? null : failedVideoId
  }

  const { videoId, activeVideoId, isOpen } = event.error
  return isOpen && videoId === activeVideoId ? videoId : failedVideoId
}

export function shouldUseCachedVideo(
  cached: boolean,
  cachedVideoId: string | null,
  currentVideoId: string,
  failedVideoId: string | null
): boolean {
  return cached && cachedVideoId === currentVideoId && failedVideoId !== currentVideoId
}
