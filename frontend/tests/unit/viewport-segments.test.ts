import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HINGE_INSET,
  computeSpannedShell,
  resolveHorizontalViewportSegments,
} from '../../src/utils/viewportSegments'

const duoSpanned = {
  first: { left: 0, width: 696, top: 0, height: 900 },
  second: { left: 712, width: 680, top: 0, height: 900 },
}

test('spanned Surface Duo segments resolve with the measured hinge gap', () => {
  const segments = resolveHorizontalViewportSegments(duoSpanned.first, duoSpanned.second)
  assert.ok(segments)
  assert.equal(segments.hingeGap, 16)
})

test('single-screen and non-foldable viewports never resolve segments', () => {
  // Non-spanned browsers report zero-size fallback segments.
  assert.equal(resolveHorizontalViewportSegments(
    { left: 0, width: 0, top: 0, height: 0 },
    { left: 0, width: 0, top: 0, height: 0 },
  ), null)
  // Duo with the app on one screen only.
  assert.equal(resolveHorizontalViewportSegments(
    { left: 0, width: 720, top: 0, height: 900 },
    { left: 0, width: 0, top: 0, height: 0 },
  ), null)
  // Stacked (portrait-spanned) segments are not a horizontal split.
  assert.equal(resolveHorizontalViewportSegments(
    { left: 0, width: 900, top: 0, height: 892 },
    { left: 0, width: 900, top: 908, height: 892 },
  ), null)
})

test('implausible measurements are rejected', () => {
  // Pane too narrow to be a real screen.
  assert.equal(resolveHorizontalViewportSegments(
    { left: 0, width: 100, top: 0, height: 900 },
    { left: 120, width: 680, top: 0, height: 900 },
  ), null)
  // Overlapping segments.
  assert.equal(resolveHorizontalViewportSegments(
    { left: 0, width: 700, top: 0, height: 900 },
    { left: 690, width: 680, top: 0, height: 900 },
  ), null)
  // Hinge gap wider than any real hinge.
  assert.equal(resolveHorizontalViewportSegments(
    { left: 0, width: 400, top: 0, height: 900 },
    { left: 900, width: 400, top: 0, height: 900 },
  ), null)
})

test('spanned shell keeps both panes clear of the hinge', () => {
  const segments = resolveHorizontalViewportSegments(duoSpanned.first, duoSpanned.second)
  assert.ok(segments)
  const shell = computeSpannedShell(segments)
  assert.ok(shell)
  // Left column ends HINGE_INSET before the hinge.
  assert.equal(shell.leftColumnWidth, 696 - HINGE_INSET)
  // Gap covers the hinge plus one inset on each side.
  assert.equal(shell.columnGap, 16 + HINGE_INSET * 2)
  const rightPaneStart = shell.leftColumnWidth + shell.columnGap
  assert.ok(rightPaneStart >= segments.second.left + HINGE_INSET - 0.001)
})
