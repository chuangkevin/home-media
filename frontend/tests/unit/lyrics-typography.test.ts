import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LYRICS_TYPOGRAPHY,
  LYRICS_TYPOGRAPHY_STORAGE_KEY,
  clampLyricsFontScale,
  decodeLyricsTypography,
  readLyricsTypography,
  scaleFontSize,
  writeLyricsTypography,
} from '../../src/utils/lyricsTypography'

test('missing, malformed and non-object preferences safely preserve existing sizes', () => {
  for (const raw of [null, '', '{', 'null', '[]', 'true', '42', '"large"']) {
    assert.deepEqual(decodeLyricsTypography(raw), DEFAULT_LYRICS_TYPOGRAPHY)
  }
})

test('independent preferences decode without expiration or TTL', () => {
  assert.deepEqual(
    decodeLyricsTypography('{"originalScale":1.5,"translationScale":2,"timestamp":0}'),
    {
      originalScale: 1.5,
      translationScale: 2,
    }
  )
  assert.deepEqual(decodeLyricsTypography('{"translationScale":2.5}'), {
    originalScale: 1,
    translationScale: 2.5,
  })
})

test('out-of-range values clamp, invalid types fall back independently', () => {
  assert.deepEqual(decodeLyricsTypography('{"originalScale":-10,"translationScale":999}'), {
    originalScale: 0.75,
    translationScale: 2.5,
  })
  assert.deepEqual(
    decodeLyricsTypography('{"originalScale":"2","translationScale":null}'),
    DEFAULT_LYRICS_TYPOGRAPHY
  )
  for (const value of [NaN, Infinity, -Infinity, undefined, null, '2', true]) {
    assert.equal(clampLyricsFontScale(value), 1)
  }
})

test('storage failure and unavailable storage are harmless', () => {
  const blocked = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('quota')
    },
  }
  assert.deepEqual(readLyricsTypography(blocked), DEFAULT_LYRICS_TYPOGRAPHY)
  assert.deepEqual(readLyricsTypography(null), DEFAULT_LYRICS_TYPOGRAPHY)
  assert.equal(writeLyricsTypography(blocked, { originalScale: 2, translationScale: 1.5 }), false)
  assert.equal(writeLyricsTypography(null, { originalScale: 2, translationScale: 1.5 }), false)
})

test('storage writes normalized values, no expiry, and reads back permanently', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
  assert.equal(writeLyricsTypography(storage, { originalScale: 20, translationScale: 1.5 }), true)
  assert.equal(
    values.get(LYRICS_TYPOGRAPHY_STORAGE_KEY),
    '{"originalScale":2.5,"translationScale":1.5}'
  )
  assert.deepEqual(readLyricsTypography(storage), { originalScale: 2.5, translationScale: 1.5 })
  assert.equal(writeLyricsTypography(storage, { ...DEFAULT_LYRICS_TYPOGRAPHY }), true)
  assert.deepEqual(readLyricsTypography(storage), DEFAULT_LYRICS_TYPOGRAPHY)
})

test('scaleFontSize preserves default numeric and string styles verbatim', () => {
  for (const base of [24, '1.5rem', ' 2vw ', 'clamp(16px, 2vw, 32px)']) {
    assert.equal(scaleFontSize(base, 1), base)
    assert.equal(scaleFontSize(base, NaN), base)
  }
})

test('scaleFontSize scales numeric pixels and CSS dimensions without float noise', () => {
  assert.equal(scaleFontSize(24, 1.5), 36)
  assert.equal(scaleFontSize(24, 999), 60)
  assert.equal(scaleFontSize(24, 0), 18)
  assert.equal(scaleFontSize('1.4rem', 1.5), '2.1rem')
  assert.equal(scaleFontSize('2vw', 2), '4vw')
  assert.equal(scaleFontSize('80%', 1.5), '120%')
  assert.equal(scaleFontSize('.8em', 2), '1.6em')
  assert.equal(scaleFontSize('20px', 1.5), '30px')
})

test('scaleFontSize supports responsive CSS expressions and custom properties', () => {
  assert.equal(scaleFontSize('clamp(16px, 2vw, 32px)', 1.5), 'calc(clamp(16px, 2vw, 32px) * 1.5)')
  assert.equal(scaleFontSize('calc(1rem + 2vw)', 2), 'calc(calc(1rem + 2vw) * 2)')
  assert.equal(scaleFontSize('var(--lyrics-size)', 2), 'calc(var(--lyrics-size) * 2)')
})
