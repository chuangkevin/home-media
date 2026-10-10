import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_LYRICS_TYPOGRAPHY,
  LYRICS_TYPOGRAPHY_STORAGE_KEY,
  decodeLyricsTypography,
  normalizeLyricsTypography,
  readLyricsTypography,
  writeLyricsTypography,
} from '../utils/lyricsTypography'
import type { LyricsTypographySettings } from '../utils/lyricsTypography'

function getDeviceStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Mount once in the lyrics owner; pass its state to the standalone controls. */
export function useLyricsTypography() {
  const [settings, setSettings] = useState<LyricsTypographySettings>(() =>
    readLyricsTypography(getDeviceStorage())
  )

  const changeSettings = useCallback((next: LyricsTypographySettings) => {
    const normalized = normalizeLyricsTypography(next)
    setSettings(normalized)
    writeLyricsTypography(getDeviceStorage(), normalized)
  }, [])

  const resetSettings = useCallback(() => {
    changeSettings({ ...DEFAULT_LYRICS_TYPOGRAPHY })
  }, [changeSettings])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== getDeviceStorage()) return
      if (event.key === LYRICS_TYPOGRAPHY_STORAGE_KEY || event.key === null) {
        setSettings(decodeLyricsTypography(event.key === null ? null : event.newValue))
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  return { settings, changeSettings, resetSettings }
}
