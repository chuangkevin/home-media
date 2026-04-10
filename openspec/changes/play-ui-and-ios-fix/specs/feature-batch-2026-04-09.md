# Feature Batch — 2026-04-09

## Status: COMPLETE

## 10 Features Implemented

| # | Feature | Status |
|---|---------|--------|
| 1 | 封鎖系統 Backend | ✅ blocked_items table + CRUD API |
| 2 | 封鎖系統 Frontend | ✅ blockSlice + SearchResults 標記 + useAutoQueue 過濾 + AdminSettings 管理 + 5s undo |
| 3 | Lazy Loading 優化 | ✅ 推薦 rootMargin 600px + 搜尋 400px + 橫向 lazy 6 張一批 |
| 4 | 翻譯歌詞廣播 | ✅ Socket.io `lyrics:translation-ready` + useLyricsSync callback |
| 5 | 優化歌詞翻譯品質 | ✅ Prompt 完整行數要求 + 覆蓋率 <50% 自動重試 + 空結果自動 retry |
| 6 | 佇列 UI 優化 | ✅ react-beautiful-dnd 拖曳排序 + Gmail 風格滑動手勢（右滑收藏、左滑移除/封鎖）|
| 7 | 無縫切歌 Gapless | ⚠️ Reverted — fade 的 async setInterval 破壞 auto-next，改回即時切換。需雙 audio element 架構重做 |
| 8 | ❤️ 收藏系統 | ✅ favorites table + toggle API + ❤️ in SearchResults + mini player |
| 9 | 首頁個人化推薦牆 | ✅ 最近播放 + 最常播放 + 我的收藏 三橫排 |
| 10 | 播放紀錄頁面 | ✅ 按日期分組 + last_played 更新 + PlaylistSection 整合 |
| 11 | 搜尋結果分類 Tab | ✅ 全部/歌曲/頻道/播放清單 前端過濾 |

## Post-Feature Bug Fixes

- autoplayBlocked 按鈕移除 → retryPlay 修復：NotAllowedError 必須 `setIsPlaying(false)` + 持續重掛 listener（`{ once: true }` + 吞錯誤會卡死背景播放）
- SponsorBlock intro skip 顯示 toast（快取+串流路徑）
- 影片切 tab 後改用 display:none 而非卸載 DOM — 避免切回重新載入 lag
- quickStartNextTrack play() 失敗 fallback
- 翻譯空結果自動 retry（10s 間隔最多 4 次）
- 首頁 tab 再按一次 = 清除搜尋回到推薦頁
- 每頻道推薦從 5 首增到 20 首
- package-lock.json 版本同步（修復 CI npm ci 失敗）
- 歌詞管線可靠性全面修復：
  - 後端 getLyrics 60s 超時保護（避免來源卡住）
  - Genius 搜尋先用 Gemini 清洗標題再查（raw YouTube 標題命中率極低）
  - Gemini extractTrackInfo 加 15s 超時 + 所有錯誤都 retry（不只 429/403）
  - LRC 時間正規式支援單位數分鐘 `\d{1,3}`
  - YouTube CC 門檻 >3 → >0（接受短歌詞）
  - NetEase isSynced 動態檢測（不 hardcode true）
  - 前端 lyrics 第一次失敗 15s 後 auto-retry（cached + streaming 路徑）
  - 前端 streaming 路徑歌詞門檻統一為 >0
- 播放清單當前歌曲滑動啟用：移除 `disabled={isCurrent}` 限制
- 播放清單焦點追蹤：auto-scroll 依賴加上 `currentVideoId`，歌曲變動自動捲動
- 移除/封鎖當前歌曲自動播下一首：`onRemove`/`onBlock` 先 dispatch `playNext()`
- 電腦版 UX 優化：
  - `isDesktop = useMediaQuery('(min-width: 768px) and (pointer: fine)')` 統一偵測
  - SwipeablePlaylistItem 電腦版 inline 顯示收藏/移除/封鎖按鈕（不走滑動手勢）
  - ChannelSection 推薦卡片播放 overlay 電腦版常駐顯示（不靠 hover）
  - ChannelSection + SearchResults hover-lift 動畫電腦版停用

## Version
- Frontend: 1.4.0 → 1.5.0
- Backend: 1.2.0 → 1.3.0
