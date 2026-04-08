# Home Media - Technical Memory

## iPhone PWA 鎖屏續播與影片恢復穩定化 (2026-04-08)
- **問題**:
  - iPhone PWA 在鎖屏連播數首後容易掉音，因為預設路徑仍依賴前端 `playNext()` 與每首重設 `audio.src`。
  - 歌詞 Drawer 頂部同時在容器與 header 吃 `safe-area-inset-top`，造成靈動島下方空間浪費，提示訊息也容易卡住頂部內容。
  - 影片模式在背景/回前景時同時受到 `AudioPlayer` 強制切模式與 `FullscreenLyrics` 影片同步控制，容易出現抖動與 lag。
- **決策**:
  - 在 `AudioPlayer` 中，針對 `iPhone + standalone PWA` 且為本地播放情境，偵測到已有曲目/播放清單時自動啟用 `continuous mode`，從根本避開 iOS 背景切歌掉音。
  - 移除 `AudioPlayer` 在背景時把 `displayMode` 從 `video` 強制切到 `visualizer` 的策略，避免和影片恢復流程互相搶狀態。
  - `FullscreenLyrics` 改為由 sticky header 單點承擔頂部 safe-area，Drawer 本體不再重複加 top padding；iPhone 直式額外壓縮 header / 模式列 / 微調列間距。
  - 頂部 `Snackbar`（例如 SponsorBlock 跳過提示）在 iPhone PWA 需額外套用 `safe-area-inset-top`，避免覆蓋靈動島與歌詞 header。
  - 影片回前景時只做一次性對齊 audio 時間並恢復播放，不再用背景切模式作為保活手段。

## iOS PWA & MediaSession (2026-04-07)
- **問題**: 同一域名 (.sisihome.org) 下多個 PWA 導致鎖定畫面喚回衝突。
- **決策**: 
  - 在 `manifest.webmanifest` 加入唯一 `id: "/home-media"`。
  - 將 `start_url` 改為 `/?pwa=radio` 以區分來源。
  - 修正 `sw.js` 預快取路徑，確保 manifest 正確載入。
  - 在 `visibilitychange` 回到前景時，由 `AudioPlayer` 強勢重新宣告 `MediaMetadata` 以爭奪 MediaSession 屬權。

## 影片播放與同步 (2026-04-07)
- **結構**: 實作「音軌權威 (Audio Authoritative)」同步。影片（IFrame/Video）一律靜音並跟隨音軌進度。
- **降級機制**: `FullscreenLyrics` 支援 YouTube IFrame 作為快取影片的 Fallback，並統一疊加字幕層。
- **效能優化**:
  - 放寬同步容差至 2-3 秒，避免微小漂移導致的不斷跳轉。
  - 實作「恢復鎖 (Recovery Lock)」：回到前景前 2.5 秒暫停同步，讓 Buffer 穩定。
  - 資源隔離：當歌詞抽屜開啟時，主動卸載底層 `VideoPlayer` 組件。

## Ultrawide (1920*720) UI 優化 (2026-04-07)
- **問題**: 矮螢幕且寬解析度下，字體過小且垂直空間被 Header/Footer 佔滿。
- **決策**:
  - 定義 `isUltrawide` 斷點：`(min-width: 1200px) and (max-height: 800px)`。
  - **字體**: 歌詞 Active 提升至 `3.8rem`，Normal 提升至 `2.4rem`。
  - 佈局: 縮減 `py` 間距，壓縮 `BottomNavigation` 高度至 48px。
  - 觸控: 關鍵按鈕尺寸改為 `large` 並增加點擊間距。
  - **歌詞微調**: 在 `isUltrawide` 模式下，將 `IconButton` 尺寸從 `small` 提升至 `large`，Icon 升級至 28px，時間 Chip 提升至 36px/1.1rem，並將按鈕間距 `gap` 提升至 2。
  - **全域巨量化**: 針對 1920*720 平板全面提升視覺比例。搜尋結果卡片縮圖高度升至 240px，標題字體升至 h6；播放清單項目高度升至 80px，標題提升至 1.15rem。


## 搜尋隨機性與上傳日期優化 (2026-04-07)
- **問題**: 搜尋結果順序固定（因 24h 快取），且曲目上傳日期未顯示或不夠醒目。
- **決策**:
  - **隨機性**: 在 `YouTubeController.search` 加入 Fisher-Yates Shuffle，隨機化前 15 筆搜尋結果。
  - **數據完整性**: 確保 `YouTubeService.ts` 中 `yt-dlp` 路徑也包含 `uploadedAt` 欄位。
  - **UI 強化**: 在 `SearchResults.tsx` 中使用醒目的標籤與 📅 圖示顯示上傳日期。

## 無限智慧推薦系統 (2026-04-07)
- **問題**: 首頁推薦內容在捲動後容易枯竭（數據源僅限觀看歷史）。
- **決策**:
  - **智慧擴展**: 在 `RecommendationService` 加入 AI 發現模式。當觀看歷史耗盡時，自動請求 Gemini 根據使用者喜好生成發現關鍵字並進行搜尋。
  - **UI 優化**: 實作 `HomeRecommendations` 的 `IntersectionObserver` 無限捲動，並加入 AI 探索中的視覺提示。
