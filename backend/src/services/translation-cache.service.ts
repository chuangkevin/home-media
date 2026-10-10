import { createHash } from 'crypto'
import { getDatabase } from '../config/database'

export interface CachedTranslation {
  translations: string[]
  detected_language: string
}

// Content version + target language identify a permanent translation. No TTL.
// JSON preserves exact line boundaries (join('\n') does not).
const PROMPT_VERSION = 'v2'
export function translationLinesHash(lines: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([PROMPT_VERSION, lines]))
    .digest('hex')
}

function database() {
  const db = getDatabase()
  // Keep the legacy table untouched: old backups remain readable and migration
  // happens only when a request proves that the stored source hash matches.
  db.exec(`CREATE TABLE IF NOT EXISTS lyrics_translations_v2 (
    video_id TEXT NOT NULL,
    lines_hash TEXT NOT NULL,
    target_language TEXT NOT NULL,
    translations_json TEXT NOT NULL,
    detected_language TEXT,
    cached_at INTEGER NOT NULL,
    PRIMARY KEY (video_id, lines_hash, target_language)
  )`)
  return db
}

function parseTranslation(row: any, lineCount: number): CachedTranslation | null {
  if (!row) return null
  try {
    const translations = JSON.parse(row.translations_json)
    if (
      !Array.isArray(translations) ||
      translations.length !== lineCount ||
      !translations.every((t) => typeof t === 'string')
    )
      return null
    return { translations, detected_language: row.detected_language || 'unknown' }
  } catch {
    return null
  }
}

export function getCachedTranslation(
  videoId: string,
  lines: string[],
  targetLanguage = 'zh-TW'
): CachedTranslation | null {
  const db = database()
  const row = db
    .prepare(
      `SELECT translations_json, detected_language FROM lyrics_translations_v2
    WHERE video_id = ? AND lines_hash = ? AND target_language = ?`
    )
    .get(videoId, translationLinesHash(lines), targetLanguage)
  const cached = parseTranslation(row, lines.length)
  if (cached) return cached

  // Legacy entries have only a zh-TW translation and a delimiter-based hash.
  // Never adopt unhashed AI entries or ambiguous embedded-newline sources.
  if (targetLanguage !== 'zh-TW' || lines.some((line) => line.includes('\n'))) return null
  const columns = db.pragma('table_info(lyrics_translations)') as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'lines_hash')) return null
  const legacyHash = createHash('md5')
    .update(PROMPT_VERSION + lines.join('\n'))
    .digest('hex')
    .substring(0, 16)
  const legacy = db
    .prepare(
      `SELECT translations_json, detected_language FROM lyrics_translations
    WHERE video_id = ? AND lines_hash = ?`
    )
    .get(videoId, legacyHash)
  const migrated = parseTranslation(legacy, lines.length)
  if (migrated) saveTranslation(videoId, lines, migrated, targetLanguage)
  return migrated
}

/** Explicitly replace this content/language version, retaining all other versions. */
export function saveTranslation(
  videoId: string,
  lines: string[],
  result: CachedTranslation,
  targetLanguage = 'zh-TW'
): void {
  if (
    result.translations.length !== lines.length ||
    !result.translations.every((t) => typeof t === 'string')
  ) {
    throw new Error('Translation must match the source line count')
  }
  database()
    .prepare(
      `INSERT INTO lyrics_translations_v2
    (video_id, lines_hash, target_language, translations_json, detected_language, cached_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id, lines_hash, target_language) DO UPDATE SET
      translations_json = excluded.translations_json,
      detected_language = excluded.detected_language, cached_at = excluded.cached_at`
    )
    .run(
      videoId,
      translationLinesHash(lines),
      targetLanguage,
      JSON.stringify(result.translations),
      result.detected_language,
      Date.now()
    )
}
