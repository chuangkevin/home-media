import { waitForAudioReady } from './playback-load'

export interface AudioHandoffIntent {
  playing: boolean
  volume: number
  muted: boolean
  playbackRate: number
}

function cancelled(): Error {
  const error = new Error('Cache audio handoff cancelled')
  error.name = 'AbortError'
  return error
}

function bounded<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown, value?: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(value as T)
    }
    const onAbort = () => finish(cancelled())
    const timer = setTimeout(
      () => finish(new Error('Cache handoff readiness timed out')),
      Math.max(1, timeoutMs)
    )
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    promise.then(
      (value) => finish(undefined, value),
      (error) => finish(error)
    )
  })
}

function seekReady(
  audio: HTMLAudioElement,
  target: number,
  signal: AbortSignal,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const events = ['seeked', 'canplay', 'loadeddata']
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      events.forEach((event) => audio.removeEventListener(event, check))
      audio.removeEventListener('error', onError)
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    const check = () => {
      if (audio.readyState >= 2 && !audio.seeking && Math.abs(audio.currentTime - target) <= 0.12)
        finish()
    }
    const onError = () => finish(new Error('Cache candidate seek failed'))
    const onAbort = () => finish(cancelled())
    const timer = setTimeout(
      () => finish(new Error('Cache candidate seek timed out')),
      Math.max(1, timeoutMs)
    )
    events.forEach((event) => audio.addEventListener(event, check))
    audio.addEventListener('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      if (signal.aborted) onAbort()
      else {
        audio.currentTime = target
        check()
      }
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Cache candidate seek failed'))
    }
  })
}

/** Prepare only the leased secondary element. The live primary source is never
 * replaced or stopped until fresh data, a completed seek and latest intent agree. */
export async function handoffAudioToCache(options: {
  primary: HTMLAudioElement
  candidate: HTMLAudioElement
  url: string
  signal: AbortSignal
  isCurrent: () => boolean
  getIntent: () => AudioHandoffIntent
  commit: () => void
  beforeCandidatePlay?: () => void
  timeoutMs?: number
}): Promise<boolean> {
  const { primary, candidate, url, signal, isCurrent, getIntent } = options
  const deadline = Date.now() + (options.timeoutMs ?? 5000)
  const remaining = () => deadline - Date.now()
  let committed = false
  const assertCurrent = () => {
    if (signal.aborted || !isCurrent() || remaining() <= 0) throw cancelled()
  }
  const align = async () => {
    while (true) {
      assertCurrent()
      const position = primary.currentTime
      if (!Number.isFinite(position) || position < 0)
        throw new Error('Live audio position unavailable')
      if (
        candidate.readyState >= 2 &&
        !candidate.seeking &&
        Math.abs(candidate.currentTime - position) <= 0.12
      )
        return
      await seekReady(candidate, position, signal, Math.min(1500, remaining()))
    }
  }
  const disposeCandidate = () => {
    if (candidate.getAttribute('src') !== url) return
    candidate.pause()
    candidate.removeAttribute('src')
    candidate.load()
    // Neutral physical-node state; the next lease applies its current owner
    // intent explicitly rather than inheriting muted cache preparation.
    candidate.muted = false
    candidate.volume = 0
    candidate.playbackRate = 1
  }
  try {
    assertCurrent()
    candidate.pause()
    candidate.muted = true
    candidate.volume = 0
    candidate.playbackRate = getIntent().playbackRate
    const ready = waitForAudioReady(candidate, signal, { timeoutMs: remaining() })
    void ready.catch(() => {})
    candidate.src = url
    candidate.load()
    await ready
    await align()
    while (true) {
      assertCurrent()
      const intent = getIntent()
      candidate.playbackRate = intent.playbackRate
      if (intent.playing && candidate.paused) {
        options.beforeCandidatePlay?.()
        const playing = candidate.play()
        void playing.then(
          () => {
            if (!committed && (signal.aborted || !isCurrent())) disposeCandidate()
          },
          () => {}
        )
        await bounded(playing, signal, remaining())
      } else if (!intent.playing && !candidate.paused) candidate.pause()
      await align()
      if (candidate.paused === !getIntent().playing) break
    }
    assertCurrent()
    const intent = getIntent()
    candidate.volume = intent.volume
    candidate.playbackRate = intent.playbackRate
    const originalMuted = primary.muted
    primary.muted = true
    try {
      options.commit()
      committed = true
    } catch (error) {
      primary.muted = originalMuted
      throw error
    }
    candidate.muted = intent.muted
    primary.pause()
    return true
  } catch {
    // The current live source still owns playback. Recover it only when the
    // owner and the user's latest play intent remain valid.
    if (isCurrent() && !signal.aborted && getIntent().playing && primary.paused) {
      void primary.play().catch(() => {})
    }
    return false
  } finally {
    if (!committed) disposeCandidate()
  }
}
