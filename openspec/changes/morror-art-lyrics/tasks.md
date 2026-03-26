## 1. Color Extraction Utility

- [ ] 1.1 Create `frontend/src/utils/extractColor.ts` — canvas-based dominant color extraction
- [ ] 1.2 Handle CORS: `crossOrigin="anonymous"`, fallback to null on failure
- [ ] 1.3 Skip near-black (< 30) and near-white (> 225) pixels
- [ ] 1.4 Cache results in a module-level Map<videoId, string>
- [ ] 1.5 Unit test: verify extraction returns hex color, handles errors

## 2. MorrorLyrics Component

- [ ] 2.1 Create `frontend/src/components/Player/MorrorLyrics.tsx`
- [ ] 2.2 Props: `lines`, `currentLineIndex`, `track`, `timeOffset`
- [ ] 2.3 Render 3 lines: previous (opacity 0.3), current (large + fill), next (opacity 0.5)
- [ ] 2.4 Karaoke fill: CSS `background-clip: text` + `@keyframes fillText` with `--line-duration`
- [ ] 2.5 Line transition: CSS transition `all 0.5s ease` on wrapper, key by lineIndex
- [ ] 2.6 Background: blurred thumbnail (blur 40px, opacity 0.3, scale 1.2) + dark overlay
- [ ] 2.7 Fetch mood color from `/api/tracks/:videoId/style`, fallback to extracted color, fallback to #4488ff
- [ ] 2.8 Handle edge cases: first line, last line, no lyrics, unsynced lyrics
- [ ] 2.9 Commit, push

## 3. Integrate into FullscreenLyrics

- [ ] 3.1 Add `'morror'` to `ViewMode` type
- [ ] 3.2 Add morror ToggleButton with AutoAwesome icon in mode switcher
- [ ] 3.3 Render `<MorrorLyrics />` when `viewMode === 'morror'`
- [ ] 3.4 Block morror mode for unsynced lyrics — show warning message
- [ ] 3.5 TypeScript check, commit, push

## 4. Testing & Polish

- [ ] 4.1 Test on mobile (375px): verify layout fills screen
- [ ] 4.2 Test on tablet (1920x720): verify text sizing
- [ ] 4.3 Test on desktop (1920x1080): verify cinematic feel
- [ ] 4.4 Test with Chinese / English / Japanese lyrics
- [ ] 4.5 Update OpenSpec status, final commit, push
