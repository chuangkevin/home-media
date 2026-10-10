import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getResponsiveLayout } from '../../src/utils/responsiveLayout'
import { getAppViewportHeight } from '../../src/utils/appViewport'

test('short landscape uses the compact deck, not the tablet pane', () => {
  for (const [width, height] of [
    [852, 393],
    [844, 390],
    [932, 430],
    [667, 375],
    [1024, 500],
  ]) {
    assert.equal(getResponsiveLayout(width, height), 'compact-landscape')
  }
})

test('roomy tablet and ultrawide CSS viewports use two panes', () => {
  for (const [width, height] of [
    [1920, 720],
    [1366, 768],
    [1194, 834],
    [1100, 700],
  ]) {
    assert.equal(getResponsiveLayout(width, height), 'wide-landscape')
  }
})

test('portrait and ordinary windows keep their existing layout', () => {
  assert.equal(getResponsiveLayout(393, 852), 'portrait')
  assert.equal(getResponsiveLayout(768, 1024), 'portrait')
  assert.equal(getResponsiveLayout(1024, 768), 'standard')
  assert.equal(getResponsiveLayout(1440, 1100), 'standard')
  assert.equal(getResponsiveLayout(1100, 501), 'wide-landscape')
  assert.equal(getResponsiveLayout(1100, 500), 'compact-landscape')
  assert.equal(getResponsiveLayout(599, 350), 'standard')
})

test('invalid/transient measurements do not invent a device class', () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.equal(getResponsiveLayout(value, 393), 'standard')
    assert.equal(getResponsiveLayout(852, value), 'standard')
  }
})

test('rotation uses the stable visible height; keyboard and zoom preserve layout semantics', () => {
  const height = getAppViewportHeight({
    innerHeight: 852,
    clientHeight: 852,
    visualHeight: 393,
    editableFocused: false,
  })
  assert.equal(getResponsiveLayout(852, height!), 'compact-landscape')
  const keyboard = getAppViewportHeight({
    innerHeight: 720,
    clientHeight: 720,
    visualHeight: 360,
    editableFocused: true,
  })
  assert.equal(keyboard, null) // App leaves both --app-dvh and data-layout unchanged.
  const zoomed = getAppViewportHeight({
    innerHeight: 720,
    clientHeight: 720,
    visualHeight: 360,
    visualScale: 2,
    editableFocused: false,
  })
  assert.equal(getResponsiveLayout(1920, zoomed!), 'wide-landscape')
})
