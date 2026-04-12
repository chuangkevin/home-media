# Home Media - Technical Memory

## iPhone Dynamic Island / Safe Area UI (2026-04-08)
- **問題**: 回退播放器修正後，iPhone PWA 的主畫面與歌詞 Drawer 再次頂到靈動島，且鎖屏回前景後 `100dvh` 有機會沿用過期高度。
- **決策**:
  - 只做純 UI 修正，不碰 `AudioPlayer`、`MediaSession`、`continuous stream`、`crossfade`。
  - 在 `App.tsx` 用 `visualViewport` 驅動 `--app-dvh`，並在 `resize/pageshow/visibilitychange/orientationchange` 後重算高度。
  - 在 `FullscreenLyrics.tsx` 改為由 sticky header 單點承擔 top safe area，Drawer 容器不再重複吃 `safe-area-inset-top`。
  - iPhone 直式下壓縮 header、模式列、微調列的垂直間距，讓內容貼近靈動島下界。

## Video Tab Background Caveat (2026-04-08)
- **問題**: 鎖屏前停在 `影片` tab 時，回前景常看到影片轉圈，且背景保活比純音訊模式更脆弱。
- **原因**:
  - `FullscreenLyrics` 在前景恢復時會主動恢復可視影片層（`seekTo` / `playVideo` / cached `<video>.play()`），即使影片是靜音的，仍可能進入 buffering spinner。
  - `AudioPlayer` 目前部分背景 fallback 直接略過 `displayMode === 'video'`，因此鎖屏前停在 `影片` tab 時，自動下一首與背景保活比純音訊模式更弱。

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

## Recommendation cold-start + lyrics stale-request guards (2026-04-12)
- **問題**:
  - live 首頁會因 `mixed` 空 cache 或 `watched_channels` 缺資料而整片沒有推薦。
  - `personalized` API 對舊資料欄位不相容，直接 500。
  - 換歌後舊歌詞請求/重試回來，會覆蓋新歌歌詞。
- **決策**:
  - `recommendation.service.ts` 在 `watched_channels` 為空時，從 `cached_tracks.last_played + channel_name` 回補推薦 seed，兼容舊資料。
  - `recommendation.controller.ts` 不再快取首頁空的 mixed response，避免空推薦被 5 分鐘 cache 黏住。
  - `personalized.routes.ts` 改用 `channel_name as channel`，且 recently/most-played 對舊 `play_count=0` 資料更寬容。
  - `AudioPlayer.tsx` 新增獨立的 `activeLyricsVideoIdRef`，在 pendingTrack 一開始就切換歌詞 request token；所有歌詞成功/失敗/loading 更新都必須先確認仍屬於目前歌曲。
  - 同類型 guard 也擴到 `FullscreenLyrics.tsx`、`LyricsView.tsx`、`useLyricsSync.ts`、`useRadioSync.ts`，避免手動換歌、遠端來源同步、或 listener 補載歌詞時把舊歌詞寫回新曲目。
  - `useContinuousPlayer.ts` 的 SSE `track-change` / `lyrics` 事件也必須套用同樣的 current-track guard，否則 continuous stream/鎖屏模式下舊歌詞仍可能透過 SSE 晚到覆蓋新歌。
  - `lyrics.controller.ts` 在 `/api/lyrics/:videoId` 前先驗證 YouTube `videoId` 格式，避免 bogus videoId 仍用 generic title/artist 搜到歌詞並污染 lyrics cache。
