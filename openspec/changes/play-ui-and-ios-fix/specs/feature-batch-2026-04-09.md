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

- autoplayBlocked 按鈕移除 — radio 模式永遠自動重試播放
- SponsorBlock intro skip 顯示 toast（快取+串流路徑）
- 影片切 tab 後改用 display:none 而非卸載 DOM — 避免切回重新載入 lag
- quickStartNextTrack play() 失敗 fallback
- 翻譯空結果自動 retry（10s 間隔最多 4 次）
- 首頁 tab 再按一次 = 清除搜尋回到推薦頁
- 每頻道推薦從 5 首增到 20 首
- package-lock.json 版本同步（修復 CI npm ci 失敗）

## Version
- Frontend: 1.4.0 → 1.5.0
- Backend: 1.2.0 → 1.3.0
