interface FollowingVideo {
  currentTime: number
  seeking: boolean
}

// Setting HTMLMediaElement.currentTime emits the same native "seeking" event
// as a user's scrub. Mark the write before touching the element because a
// media implementation may deliver that event synchronously.
const followingSeeks = new WeakMap<FollowingVideo, number>()

export function seekFollowingVideo(video: FollowingVideo, target: number): boolean {
  if (!Number.isFinite(target) || target < 0) return false
  if (Math.abs(video.currentTime - target) < 0.05) return false
  const previousTarget = followingSeeks.get(video)
  followingSeeks.set(video, target)
  try {
    video.currentTime = target
    return true
  } catch (error) {
    if (previousTarget === undefined) followingSeeks.delete(video)
    else followingSeeks.set(video, previousTarget)
    throw error
  }
}

export function isFollowingVideoSeek(video: FollowingVideo): boolean {
  const target = followingSeeks.get(video)
  if (target === undefined) return false
  if (Math.abs(video.currentTime - target) < 0.1) return true
  // A different target is a real user scrub that superseded the follower seek.
  followingSeeks.delete(video)
  return false
}

export function finishFollowingVideoSeek(video: FollowingVideo): void {
  // A delayed seeked event for an older write must not clear the marker while
  // a newer seek is still in flight.
  if (!video.seeking) followingSeeks.delete(video)
}
