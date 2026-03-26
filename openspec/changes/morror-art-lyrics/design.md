## Context

Home-media has a FullscreenLyrics component with three viewModes: lyrics (scrolling), video (YouTube embed), cover (album art). We are adding a fourth mode `'morror'` that shows an immersive karaoke-style display inspired by the MORROR ART speaker. The existing lyrics data (LRC with per-line timestamps) is already available via Redux state. Gemini style analysis (mood, energy) is cached in the backend `track_styles` table.

## Goals / Non-Goals

**Goals:**
- Create a visually stunning, immersive lyrics experience
- Simulate karaoke word-by-word fill using per-line timestamps
- Dynamic theming based on album art colors and AI mood analysis
- Smooth animations and transitions

**Non-Goals:**
- True word-by-word timing (requires Enhanced LRC which we don't have)
- WebGL/3D particle effects (keep it CSS-only for performance)
- Modifying any existing layout, positioning, or component structure

## Decisions

### D1: New component `MorrorLyrics.tsx`
Create a standalone component in `frontend/src/components/Player/MorrorLyrics.tsx`. It receives lyrics lines, current line index, and track info as props. FullscreenLyrics renders it when `viewMode === 'morror'`.

### D2: Karaoke fill animation technique
Use CSS `background-clip: text` with animated `background-size`:
```css
.karaoke-line {
  background: linear-gradient(to right, var(--accent) 50%, rgba(255,255,255,0.4) 50%);
  background-size: 200% 100%;
  background-position: 100% 0;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: fillText var(--line-duration) linear forwards;
}
@keyframes fillText {
  to { background-position: 0 0; }
}
```
`--line-duration` = `nextLine.time - currentLine.time` seconds.

### D3: Color extraction from thumbnail
Use a hidden `<canvas>` element to load the thumbnail image, sample pixels, and compute the dominant color. Cache the result per videoId using a `useRef`. Algorithm: sample 100 pixels, find most frequent hue bucket (ignoring near-white/black).

### D4: Mood-to-color mapping
```typescript
const moodColors: Record<string, string> = {
  energetic: '#ff4444',
  upbeat: '#ff8800',
  chill: '#4488ff',
  dreamy: '#aa66ff',
  melancholic: '#6688aa',
  romantic: '#ff66aa',
  dark: '#8844aa',
  aggressive: '#ff2222',
};
```
Fetch mood from `/api/tracks/:videoId/style` on mount. If no style data, fallback to extracted dominant color. If no thumbnail, fallback to `#4488ff`.

### D5: Background layers (bottom to top)
1. Solid black `#000`
2. Album thumbnail blurred (`filter: blur(40px)`, `opacity: 0.3`, `transform: scale(1.2)`)
3. Dark gradient overlay (`rgba(0,0,0,0.6)`)
4. Lyrics text (centered, large)

### D6: Layout structure
```
┌──────────────────────────────────┐
│                                  │
│         (previous line)          │  opacity: 0.3, small
│                                  │
│     ████████ current line        │  large, karaoke fill animation
│                                  │
│         (next line)              │  opacity: 0.5, medium
│                                  │
└──────────────────────────────────┘
```
Show 3 lines: previous (fading out), current (large + fill animation), next (preview). Transition between lines using CSS opacity + transform animations.

### D7: Line transition animation
When `currentLineIndex` changes:
- Old current → moves up, shrinks, fades to 0.3 opacity
- Old next → moves up, grows, starts fill animation
- New next → fades in from below

Use CSS `transition: all 0.5s ease` on wrapper divs.

## Risks / Trade-offs

- **[Risk] Canvas CORS for thumbnail** → Thumbnail URLs are from YouTube (cross-origin). Use `crossOrigin="anonymous"` on the image. If CORS fails, fallback to mood color or default blue.
- **[Risk] Fill animation timing mismatch** → LRC timestamps may be imprecise. The fill animation duration is an approximation. Acceptable since MORROR ART also approximates.
- **[Trade-off] No true word-by-word** → Would need Enhanced LRC or AI word segmentation. Out of scope for v1. Per-line fill is visually close enough.
