## 1. Z-index & Bottom Spacing

- [x] 1.1 Fix z-index: AudioPlayer 1100, BottomNav 1200 in App.tsx
- [x] 1.2 Replace hardcoded pb='250px' with dynamic calc() based on viewport
- [ ] 1.3 Verify stacking order works on all devices — **待測**

## 2. Compact Player

- [x] 2.1 Add useMediaQuery for short viewport detection (max-height: 768px)
- [x] 2.2 Implement compact player mode: hide thumbnail, single-line title, smaller icons
- [x] 2.3 Keep play button >= 48px in compact mode
- [ ] 2.4 Verify on mobile and 1920x720 tablet — **待測**

## 3. Fullscreen Lyrics / Drawer 重構

- [x] 3.1 Drawer 改為全螢幕 (height: 100%, bottom: 0)
- [x] 3.2 底部嵌入式播放器 (AudioPlayer embedded)
- [x] 3.3 Replace 30vh padding with 10vh/25vh based on viewport
- [x] 3.4 LyricsView height responsive: 100%
- [x] 3.5 捲軸加粗 (6px, rgba white)
- [ ] 3.6 還原頂部操作列 position:absolute 的錯誤改動（已 revert）
- [ ] 3.7 **待測**: 手機歌詞顯示正常
- [ ] 3.8 **待測**: 平板歌詞顯示正常
- [ ] 3.9 **待測**: 桌面歌詞顯示正常

## 4. Desktop Grid Optimization

- [x] 4.1 SearchResults: add lg={3} breakpoint for 4 columns on desktop
- [x] 4.2 ChannelSection cards: responsive minWidth (240px mobile, 280px+ desktop)
- [x] 4.3 AdminSettings: increase maxWidth to 1600px on xl screens
- [ ] 4.4 **待測**: 桌面寬螢幕顯示正常

## 5. Video Playback (跨平台)

- [x] 5.1 Mac 白畫面: 加 loading spinner + 黑色背景 + error fallback
- [x] 5.2 iPhone 影片: 移除自訂 PlayArrow，用 YouTube 原生按鈕
- [x] 5.3 FullscreenLyrics 影片 playVideo() 加 try/catch
- [ ] 5.4 **待測**: Mac Safari 影片模式
- [ ] 5.5 **待測**: iPhone 影片模式
- [ ] 5.6 **待測**: Windows Chrome 影片模式

## 6. Media Session (鎖屏控制)

- [x] 6.1 移除 seekbackward/seekforward handler 顯示上下首按鈕
- [x] 6.2 影片模式保留 audio 元素 (muted) 維持 Media Session
- [ ] 6.3 **待測**: iPhone 鎖屏顯示上下首按鈕
- [ ] 6.4 **待測**: 影片模式鎖屏仍可控制

## 7. Final Verification

- [ ] 7.1 Visual test on mobile (375px)
- [ ] 7.2 Visual test on tablet (1920x720)
- [ ] 7.3 Visual test on desktop (1920x1080)
- [ ] 7.4 All tests pass, final commit, push
