import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { getAppViewportHeight } from '../../src/utils/appViewport'

const measure = (innerHeight: number, visualHeight = innerHeight, clientHeight = innerHeight,
  visualScale = 1, editableFocused = false) => getAppViewportHeight({
  innerHeight, visualHeight, clientHeight, visualScale, editableFocused,
})

test('tablet, phone and desktop viewport matrix retains the current visible height', () => {
  for (const [width, height] of [[1024, 768], [1180, 820], [1194, 834], [1366, 1024],
    [820, 1180], [390, 844], [1440, 900]]) {
    assert.equal(measure(height), height, `${width}x${height}`)
  }
})

test('portrait-to-landscape rotation cannot retain a stale taller measurement', () => {
  assert.equal(measure(820, 820, 1180), 820, 'stale document height')
  assert.equal(measure(1180, 820, 1180), 820, 'stale inner height')
  assert.equal(measure(820, 1180, 1180), 820, 'stale visual height')
  assert.equal(measure(1180), 1180, 'rotation back to portrait converges')
})

test('browser chrome does not place the player below the visible viewport', () => {
  assert.equal(measure(820, 744, 820), 744)
  assert.equal(measure(768, 692, 768), 692)
})

test('pinch zoom preserves layout pixels without confusing zoom with the keyboard', () => {
  assert.equal(measure(820, 410, 820, 2), 820)
  assert.equal(measure(820, 1025, 820, 0.8), 820)
  assert.equal(measure(820, 410, 820, 2, true), 820)
})

test('keyboard guard preserves the existing height until editing ends', () => {
  assert.equal(measure(820, 440, 820, 1, true), null)
  assert.equal(measure(820, 440), 440)
  assert.equal(measure(820, 820, 820, 1, true), 820)
})

test('missing or invalid viewport measurements use a positive fallback', () => {
  assert.equal(measure(820, 0, 1180), 820)
  assert.equal(measure(0, 0, 768), 768)
  assert.equal(measure(0, 744, 0), 744)
  assert.equal(measure(NaN, 0, 768), 768)
  assert.equal(measure(0, 0, 0), null)
})

test('App uses the viewport calculation on resize, orientation and foreground recovery', () => {
  const app = readFileSync('src/App.tsx', 'utf8')
  assert.match(app, /const stableHeight = getAppViewportHeight\(/)
  assert.match(app, /visualScale: window.visualViewport\?\.scale/)
  for (const event of ['resize', 'orientationchange', 'pageshow', 'visibilitychange']) {
    assert.ok(app.includes(`addEventListener('${event}'`), event)
  }
  assert.match(app, /if \(stableHeight === null\) return/)
  assert.doesNotMatch(app, /Math\.max\(vvHeight, fullHeight, clientHeight\)/)
})
