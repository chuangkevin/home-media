interface AppViewportMeasurements {
  innerHeight: number
  clientHeight: number
  visualHeight?: number
  visualScale?: number
  editableFocused: boolean
}

// Keep the bottom player inside the visible layout viewport. During rotation,
// Safari can briefly report the old (taller) height from one of these sources.
// Taking the maximum makes that stale measurement win and clips the player.
export function getAppViewportHeight({
  innerHeight,
  clientHeight,
  visualHeight = 0,
  visualScale = 1,
  editableFocused,
}: AppViewportMeasurements): number | null {
  const positive = (value: number) => Number.isFinite(value) && value > 0
  const layoutHeight = positive(innerHeight) ? innerHeight : clientHeight
  // Pinch zoom should magnify the existing layout, not resize it. Convert the
  // visual viewport back to layout pixels before comparing viewport heights.
  const visibleHeight = visualHeight * (positive(visualScale) ? visualScale : 1)
  if (editableFocused && positive(visibleHeight) && layoutHeight - visibleHeight > 100) {
    return null // Keep the existing layout while the on-screen keyboard is open.
  }
  const heights = [layoutHeight, visibleHeight].filter(positive)
  return heights.length ? Math.min(...heights) : null
}
