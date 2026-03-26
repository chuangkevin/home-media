## Why

The current lyrics display is functional but not visually immersive. Users want a premium karaoke-style experience inspired by the MORROR ART transparent floating lyrics speaker — large text, karaoke fill effect, mood-driven colors, and cinematic background. This transforms the app from a simple music player into a visual music experience, which is the core differentiator for a personal streaming platform.

## What Changes

- Add a new `'morror'` viewMode to FullscreenLyrics alongside existing lyrics/video/cover modes
- Implement karaoke-style text fill animation (left-to-right color gradient synced to line duration)
- Display only current + next line in large centered text with fade transitions
- Extract dominant color from album thumbnail for animated gradient background
- Use Gemini mood analysis to drive accent color (energetic=red, chill=blue, romantic=pink, etc.)
- Add blur overlay of album art as cinematic background
- Fallback to normal lyrics view when lyrics are not synced (no timestamps)

## Capabilities

### New Capabilities
- `morror-lyrics-mode`: Immersive MORROR ART style lyrics display with karaoke fill, mood colors, and cinematic background
- `color-extraction`: Extract dominant color from album thumbnail for dynamic theming

### Modified Capabilities

## Impact

- **Frontend only**: `FullscreenLyrics.tsx` (new render mode + mode toggle), new `MorrorLyrics.tsx` component
- **No backend changes**: Uses existing lyrics data, existing Gemini style analysis results
- **No positioning changes**: Does NOT touch AudioPlayer, Drawer, PlayerControls, or any layout values
- **Dependencies**: No new npm packages (uses native Canvas API for color extraction, CSS animations for karaoke effect)
