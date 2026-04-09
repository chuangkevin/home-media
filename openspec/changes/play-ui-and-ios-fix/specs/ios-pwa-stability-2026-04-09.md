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

### 6. Bug Fixes
- 影片下載 retry (3 次 + backoff)
- 影片下載不再限制 video tab — Drawer 開啟就開始
- `play_count` 在 complete signal 時正確累加
- Snackbar toast 避開 iPhone 動態島 safe-area
- 鍵盤彈出不更新 `--app-dvh` 避免播放器跑位
- Media Session `seekto` handler 啟用 — 鎖屏進度條可拖動
- 影片 tab 下載進度改用 spinner 避免按鈕跑版
- Mini player 加 `touchAction: 'none'` 防止意外拖動
- 移除連續串流 `∞` 按鈕（無限播放本來就是預設行為）
