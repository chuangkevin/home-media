import { getActivePlaybackAudio } from './active-audio'

interface YouTubeVisualPlayer {
  mute(): void
  playVideo(): void
  pauseVideo(): void
  seekTo(position: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getPlayerState(): number
}

/** The iframe is a muted visual follower. The active audio owner and latest
 * user intent stay authoritative, including delayed readiness and buffering. */
export function createYouTubeVideoFollower(options: {
  isCurrent: () => boolean
  getPlayer: () => YouTubeVisualPlayer | null
  getPlaying: () => boolean
  now?: () => number
  onBlockedChange?: (blocked: boolean) => void
}) {
  let player: YouTubeVisualPlayer | null = null
  let ready = false
  let disposed = false
  let buffering = false
  let autoplayBlocked = false
  let previousIntent = options.getPlaying()
  let lastSeekAt = -Infinity
  let command: 'play' | 'pause' | null = null
  const now = options.now ?? Date.now
  const owns = (target = player) =>
    !disposed &&
    options.isCurrent() &&
    target !== null &&
    target === player &&
    options.getPlayer() === target
  const source = () => getActivePlaybackAudio()
  const synchronize = () => {
    if (!ready || !owns() || buffering || autoplayBlocked || player!.getPlayerState() === 3) return
    if (command === 'play' && player!.getPlayerState() !== 1) return
    const audio = source()
    if (!audio || audio.readyState < 2 || audio.seeking || !Number.isFinite(audio.currentTime))
      return
    // YouTube seekTo starts playback from cued/unstarted. A paused user must
    // first have a confirmed PAUSED player before positional alignment is safe.
    if ((!options.getPlaying() || audio.paused) && player!.getPlayerState() !== 2) return
    const position = audio.currentTime
    const videoPosition = player!.getCurrentTime()
    if (Math.abs(videoPosition - position) <= 0.3 || now() - lastSeekAt < 1000) return
    // Mark before calling the SDK; seekTo may synchronously emit buffering.
    lastSeekAt = now()
    player!.seekTo(position, true)
  }
  const control = () => {
    if (!ready || !owns()) return
    const audio = source()
    const intent = options.getPlaying()
    if (intent !== previousIntent) {
      previousIntent = intent
      autoplayBlocked = false
      command = null
      options.onBlockedChange?.(false)
    }
    const shouldPlay = intent && !!audio && !audio.paused && audio.readyState >= 2
    const state = player!.getPlayerState()
    if (shouldPlay) {
      if (autoplayBlocked) return
      if (state === 1 || state === 3 || command === 'play') return
      command = 'play'
      player!.playVideo()
    } else if ((state === 1 || state === 3 || command === 'play') && command !== 'pause') {
      command = 'pause'
      player!.pauseVideo()
    }
  }
  return {
    onReady(event: { target: YouTubeVisualPlayer }): boolean {
      if (disposed || !options.isCurrent() || options.getPlayer() !== event.target) return false
      player = event.target
      // Must be the first SDK command. Initial autoplay is disabled by callers.
      player.mute()
      ready = true
      buffering = player.getPlayerState() === 3
      synchronize()
      control()
      return true
    },
    onStateChange(event: { target: YouTubeVisualPlayer; data: number }): void {
      if (!ready || !owns(event.target)) return
      buffering = event.data === 3
      if (event.data === 1) {
        player!.mute()
        autoplayBlocked = false
        options.onBlockedChange?.(false)
      }
      if ((event.data === 1 && command === 'play') || (event.data === 2 && command === 'pause'))
        command = null
      control()
      synchronize()
    },
    onAutoplayBlocked(event: { target: YouTubeVisualPlayer }): void {
      if (!ready || !owns(event.target)) return
      autoplayBlocked = true
      options.onBlockedChange?.(true)
    },
    retryOnGesture(): void {
      if (!ready || !owns()) return
      // Only an explicit new user gesture may retry an unacknowledged command.
      autoplayBlocked = false
      command = null
      player!.mute()
      control()
    },
    tick(): void {
      synchronize()
      control()
    },
    dispose(): void {
      disposed = true
      ready = false
      player = null
    },
  }
}
