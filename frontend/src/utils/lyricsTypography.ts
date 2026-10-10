export interface LyricsTypographySettings {
  originalScale: number
  translationScale: number
}

export const LYRICS_TYPOGRAPHY_STORAGE_KEY = 'home-media:lyrics-typography:v1'
export const MIN_LYRICS_FONT_SCALE = 0.75
export const MAX_LYRICS_FONT_SCALE = 2.5
export const DEFAULT_LYRICS_TYPOGRAPHY: Readonly<LyricsTypographySettings> = Object.freeze({
  originalScale: 1,
  translationScale: 1,
})

export function clampLyricsFontScale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_LYRICS_FONT_SCALE, Math.max(MIN_LYRICS_FONT_SCALE, value))
    : 1
}

export function normalizeLyricsTypography(value: unknown): LyricsTypographySettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_LYRICS_TYPOGRAPHY }
  }
  const settings = value as Record<string, unknown>
  return {
    originalScale: clampLyricsFontScale(settings.originalScale),
    translationScale: clampLyricsFontScale(settings.translationScale),
  }
}

/** Permanent device preference: deliberately no timestamp or expiration. */
export function decodeLyricsTypography(raw: string | null): LyricsTypographySettings {
  try {
    return normalizeLyricsTypography(raw === null ? null : JSON.parse(raw))
  } catch {
    return { ...DEFAULT_LYRICS_TYPOGRAPHY }
  }
}

export type LyricsTypographyStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readLyricsTypography(
  storage?: LyricsTypographyStorage | null
): LyricsTypographySettings {
  try {
    return decodeLyricsTypography(storage?.getItem(LYRICS_TYPOGRAPHY_STORAGE_KEY) ?? null)
  } catch {
    return { ...DEFAULT_LYRICS_TYPOGRAPHY }
  }
}

/** False means storage is unavailable; callers can still apply the change in memory. */
export function writeLyricsTypography(
  storage: LyricsTypographyStorage | null | undefined,
  settings: LyricsTypographySettings
): boolean {
  try {
    if (!storage) return false
    storage.setItem(
      LYRICS_TYPOGRAPHY_STORAGE_KEY,
      JSON.stringify(normalizeLyricsTypography(settings))
    )
    return true
  } catch {
    return false
  }
}

/** Numeric bases keep MUI's px semantics; strings retain CSS units/responsive math. */
export function scaleFontSize(base: number | string, scale: number): number | string {
  const factor = clampLyricsFontScale(scale)
  if (factor === 1) return base
  if (typeof base === 'number') return base * factor
  const trimmed = base.trim()
  const dimension = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]+)$/i.exec(trimmed)
  if (dimension) return `${Number((Number(dimension[1]) * factor).toFixed(6))}${dimension[2]}`
  return `calc(${trimmed} * ${factor})`
}
