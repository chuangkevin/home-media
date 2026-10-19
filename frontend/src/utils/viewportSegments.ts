// Dual-screen (Surface Duo class) viewport segment measurement.
// Browsers on spanned foldables expose each screen via the `viewport-segment-*`
// CSS env values; every other device reports zero-size segments, so the app
// keeps its normal responsive layout. Geometry stays pure and unit-tested;
// only the probe touches the DOM.

export interface ViewportSegment {
  left: number
  width: number
  top: number
  height: number
}

export interface HorizontalViewportSegments {
  first: ViewportSegment
  second: ViewportSegment
  hingeGap: number
}

// Sanity bounds so a bogus measurement can never produce an unusable shell.
const MIN_PANE_WIDTH = 240
const MAX_HINGE_GAP = 240
// Blank space kept on each side of the hinge so no text or touch target sits
// on the fold.
export const HINGE_INSET = 16

export function resolveHorizontalViewportSegments(
  first: ViewportSegment,
  second: ViewportSegment,
): HorizontalViewportSegments | null {
  if (first.width < MIN_PANE_WIDTH || second.width < MIN_PANE_WIDTH) return null
  if (first.height <= 0 || second.height <= 0) return null
  if (Math.abs(first.top - second.top) > 2 || Math.abs(first.height - second.height) > 2) return null
  const hingeGap = second.left - (first.left + first.width)
  if (hingeGap < 0 || hingeGap > MAX_HINGE_GAP) return null
  return { first, second, hingeGap }
}

// Grid geometry that aligns the two-pane split with the hinge: the left pane
// ends before the hinge and the right pane starts after it.
export function computeSpannedShell(
  segments: HorizontalViewportSegments,
): { leftColumnWidth: number; columnGap: number } | null {
  const leftColumnWidth = segments.first.left + segments.first.width - HINGE_INSET
  const columnGap = segments.hingeGap + HINGE_INSET * 2
  if (leftColumnWidth < MIN_PANE_WIDTH || columnGap <= 0) return null
  return { leftColumnWidth, columnGap }
}

function readViewportSegment(column: number, row: number): ViewportSegment | null {
  if (typeof document === 'undefined') return null
  const probe = document.createElement('div')
  probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;left:env(viewport-segment-left ${column} ${row}, 0px);top:env(viewport-segment-top ${column} ${row}, 0px);width:env(viewport-segment-width ${column} ${row}, 0px);height:env(viewport-segment-height ${column} ${row}, 0px)`
  document.body.appendChild(probe)
  const { left, top, width, height } = probe.getBoundingClientRect()
  probe.remove()
  return { left, top, width, height }
}

export function measureHorizontalViewportSegments(): HorizontalViewportSegments | null {
  // Edge ≥97 on spanned foldables publishes window.visualViewport.segments —
  // the official JS twin of the CSS env() probe.
  if (typeof window !== 'undefined') {
    const segments = (window.visualViewport as (VisualViewport & { segments?: { left: number; top: number; width: number; height: number }[] }) | null | undefined)?.segments
    if (Array.isArray(segments) && segments.length === 2) {
      const sorted = segments.map(s => ({ left: s.left, top: s.top, width: s.width, height: s.height }))
        .sort((a, b) => a.top - b.top || a.left - b.left)
      return resolveHorizontalViewportSegments(sorted[0], sorted[1])
    }
  }
  const first = readViewportSegment(0, 0)
  const second = readViewportSegment(1, 0)
  return first && second ? resolveHorizontalViewportSegments(first, second) : null
}

export interface SpannedHinge {
  leftWidth: number
  columnGap: number
}

// Surface Duo 1 spanned landscape in CSS pixels: two ~720px screens with a
// narrow hinge at the centre. Used as a fallback when the browser does not
// expose viewport segments; a desktop window in the same range gets the same
// (still sensible) centre split.
const DUO_SPANNED_MIN_WIDTH = 1300
const DUO_SPANNED_MAX_WIDTH = 1450
const DUO_SPANNED_MIN_HEIGHT = 550
const DUO_SPANNED_MAX_HEIGHT = 950

export function detectSpannedHinge(width: number, height: number): SpannedHinge | null {
  // Duo simulator support: the local duo-simulator page passes ?duoSim=<mode>.
  const mode = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('duoSim') : null
  if (mode === 'landscape-span') {
    return { leftWidth: 672 - HINGE_INSET, columnGap: 48 + HINGE_INSET * 2 }
  }
  const shell = computeSpannedShellSafe(measureHorizontalViewportSegments())
  if (shell) return { leftWidth: shell.leftColumnWidth, columnGap: shell.columnGap }
  if (
    width >= DUO_SPANNED_MIN_WIDTH && width <= DUO_SPANNED_MAX_WIDTH &&
    height >= DUO_SPANNED_MIN_HEIGHT && height <= DUO_SPANNED_MAX_HEIGHT &&
    width / height >= 1.45
  ) {
    return { leftWidth: Math.round(width / 2) - 24, columnGap: 48 }
  }
  return null
}

function computeSpannedShellSafe(segments: HorizontalViewportSegments | null) {
  return segments ? computeSpannedShell(segments) : null
}
