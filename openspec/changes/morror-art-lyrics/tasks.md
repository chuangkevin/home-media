## 1. Color Extraction Utility

- [x] 1.1 Create `frontend/src/utils/extractColor.ts` — canvas-based dominant color extraction
- [x] 1.2 Handle CORS: `crossOrigin="anonymous"`, fallback to null on failure
- [x] 1.3 Skip near-black (< 30) and near-white (> 225) pixels
- [x] 1.4 Cache results in a module-level Map<videoId, string>

## 2. MorrorLyrics Component

- [x] 2.1 Create `frontend/src/components/Player/MorrorLyrics.tsx`
- [x] 2.2 6 種效果: 逐字填色、逐字放大、打字機、霓虹燈、漸層波浪、模糊聚焦
- [x] 2.3 逐字動畫 (CharByChar component)
- [x] 2.4 Background: blurred thumbnail + dark overlay
- [x] 2.5 Mood color / thumbnail extraction / default fallback
- [x] 2.6 Audio-reactive Canvas visualizer (頻譜柱 + bass 光暈 + 節拍粒子)
- [x] 2.7 useAudioAnalyser hook (Web Audio API AnalyserNode)
- [x] 2.8 Effect selector (localStorage 記住選擇)
- [x] 2.9 Fullscreen 由 Drawer 控制 (onFullscreenChange callback)

## 3. Integrate into FullscreenLyrics

- [x] 3.1 Add `'morror'` to `ViewMode` type
- [x] 3.2 Add morror ToggleButton with AutoAwesome icon
- [x] 3.3 Render `<MorrorLyrics />` when `viewMode === 'morror'`
- [x] 3.4 Disabled for unsynced lyrics
- [x] 3.5 Fullscreen: 隱藏 header/playlist/controls

## 4. Testing & Polish

- [ ] 4.1 **待測**: 手機效果
- [ ] 4.2 **待測**: 平板效果
- [ ] 4.3 **待測**: 桌面效果
- [ ] 4.4 **待測**: 中/英/日文歌詞
