export type AppLayout = 'portrait' | 'standard' | 'compact-landscape' | 'wide-landscape'

// CSS pixels, not hardware pixels or user-agent detection. Keep the compact
// height boundary separate from the roomy two-pane tablet/ultrawide layout.
export function getResponsiveLayout(width: number, height: number): AppLayout {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'standard'
  }
  if (width <= height) return 'portrait'
  if (width >= 600 && height <= 500 && width / height >= 1.25) return 'compact-landscape'
  if (width >= 1100 && height > 500 && width / height >= 1.4) return 'wide-landscape'
  return 'standard'
}
