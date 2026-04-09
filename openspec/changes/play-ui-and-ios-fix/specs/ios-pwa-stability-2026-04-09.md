# iOS PWA Playback Stability — 2026-04-09

## Status: COMPLETE

## Summary
修復 iOS PWA 鎖屏後無法自動播放下一首、黑畫面重載、影片同步、UI 跑版等問題。

## Changes Made

### 1. Playback State Persistence (crash recovery)
- 新增 `playback-state.service.ts` — 每 5s + visibilitychange 存 playlist/index/time 到 localStorage
- 新增 `usePlaybackPersistence.ts` hook — 自動存 Redux 狀態
- `App.tsx` 載入時優先從 localStorage 恢復，含 seek 到上次位置
- `AudioPlayer.tsx` 播放成功後消費 `recoverySeekTarget`

### 2. iOS Background Quick-Start
- 歌曲 90% 時預建下一首 blob URL（從 IndexedDB cache）
- `ended` 事件觸發時直接 `audio.src = blobUrl; audio.play()`，不走 Redux
- 所有換歌入口都優先走 `quickStartNextTrack()`

### 3. Memory Pressure Reduction
- cached `<video>` DOM 只在 video tab 時渲染
- `checkFakePlayback` 和 `updatePositionState` 背景時跳過（但 setPositionState 後來移除此限制）

### 4. Video A/V Sync Tightening
- YouTube iframe: 2s→1s hard seek + 0.3-1s playbackRate nudge (1.05/0.95)
- Cached video: 0.9→0.7s hard seek, 0.96-1.04 playbackRate, 600ms interval

### 5. Video Lyrics Overlay
- 新增 `VideoLyricsOverlay.tsx` — 影片 tab 顯示當前歌詞 + 翻譯

### 6. Lock Screen Recovery
- 鎖屏解鎖後影片 `syncOnce` 加 `recoveryLockRef` 檢查，不再瘋狂 seek
- 恢復流程改為：seek（暫停態）→ 2s 後 seek+play → 3s 後解除 lock
- Media Session `seekto` handler 啟用 — 鎖屏進度條可拖動
- `setPositionState` 移除 `document.hidden` guard — 鎖屏也需要更新進度

### 7. UI / UX Fixes
- Snackbar toast 避開 iPhone 動態島 safe-area (`env(safe-area-inset-top)`)
- 鍵盤彈出不更新 `--app-dvh`（`visualViewport.height` 比 `innerHeight` 小 >100px 時跳過）
- 影片 tab 下載進度改用 spinner 避免 ToggleButton 跑版
- Mini player 加 `touchAction: 'none'` + `userSelect: 'none'` 防止誤觸拖動
- 移除連續串流 `∞` 按鈕（無限播放本來就是預設行為）
- 手機 tab 按鈕縮小（px:1.2, fontSize:0.75rem），車用螢幕微調按鈕放大（52px, icon:36px）

### 8. Playback Quality
- 影片下載 retry (3 次 + exponential backoff)
- 影片下載不再限制 video tab — Drawer 開啟就開始下載
- `play_count` 在 complete signal 時正確累加 + 更新 `last_played`
- 自動佇列同藝人+歌名去重（防止同歌不同 MV 重複）

### 9. Lyrics Improvements
- 歌詞搜尋順序改為 LRCLIB → NetEase → Genius → YouTube CC（synced 優先）
- 找到 non-synced 不立即回傳，繼續找 synced 的
- NetEase artist 修復 Unknown Artist（相容 `song.artists` 和 `song.ar` 兩種 API 格式）
- 翻譯穩定性：前端 null result 進入 retry；後端用完所有 key 重試（不是只換 1 次）
- 翻譯 prompt 版本 v2 使用 indexed-object format 避免行數位移
