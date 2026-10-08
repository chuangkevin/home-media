export interface VideoCachePollingRef {
  current: string | null
}

export interface VideoCacheStatus {
  cached: boolean
  downloading: boolean
}

export const VIDEO_CACHE_POLL_INTERVAL_MS = 3_000
// Backend yt-dlp jobs time out at 300s; allow another 30s for producer close
// and status propagation before showing a client-side timeout.
export const VIDEO_CACHE_POLL_MAX_DURATION_MS = 330_000

export function hasVideoCachePollingExpired(elapsedMs: number): boolean {
  return elapsedMs >= VIDEO_CACHE_POLL_MAX_DURATION_MS
}

/**
 * Claim one polling lifecycle for a video. Releasing the claim lets a later
 * open of the same track start a fresh poll after the previous one was canceled.
 */
export function claimVideoCachePolling(
  ref: VideoCachePollingRef,
  videoId: string
): (() => void) | null {
  if (ref.current === videoId) return null

  ref.current = videoId
  let released = false

  return () => {
    if (released) return
    released = true
    if (ref.current === videoId) ref.current = null
  }
}

/**
 * A 202 response only means the server accepted the request. Once that
 * request is accepted, an idle, uncached status means the producer finished
 * without creating a cache entry and should be retried/reported as failed.
 */
export function isVideoCacheProducerFailure(
  status: VideoCacheStatus,
  downloadRequestAccepted: boolean
): boolean {
  return downloadRequestAccepted && !status.cached && !status.downloading
}
