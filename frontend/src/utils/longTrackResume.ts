// Per-track resume position, only for long-form audio (podcasts, DJ sets,
// lectures). Kept deliberately separate from the session playback-state
// service, which is cleared on refresh by design.
const STORAGE_KEY = 'home-media.resume.v1'
export const LONG_TRACK_SECONDS = 15 * 60

type ResumeMap = Record<string, { t: number; d: number; at: number }>

function read(): ResumeMap {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as ResumeMap
  } catch {
    return {}
  }
}

function write(map: ResumeMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* storage full or unavailable — resume is best-effort */
  }
}

export function saveResumePosition(videoId: string, position: number, duration: number): void {
  if (!videoId || !Number.isFinite(position) || !Number.isFinite(duration)) return
  if (duration < LONG_TRACK_SECONDS) return
  if (position < 30 || position > duration - 30) return
  const map = read()
  map[videoId] = { t: Math.floor(position), d: Math.floor(duration), at: Date.now() }
  // Keep the map small.
  const entries = Object.entries(map).sort((a, b) => b[1].at - a[1].at).slice(0, 200)
  write(Object.fromEntries(entries))
}

export function getResumePosition(videoId: string, duration: number): number | null {
  if (!videoId) return null
  const entry = read()[videoId]
  if (!entry) return null
  if (duration > 0 && Math.abs(entry.d - duration) > 90) return null // different cut/version
  if (entry.t < 30 || (duration > 0 && entry.t > duration - 30)) return null
  return entry.t
}

export function clearResumePosition(videoId: string): void {
  const map = read()
  if (!(videoId in map)) return
  delete map[videoId]
  write(map)
}
