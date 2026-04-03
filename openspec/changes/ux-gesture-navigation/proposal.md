## Why

用戶在關閉全螢幕歌詞時，直覺地嘗試下拉（如 YouTube Music），但目前只能點右上角按鈕。首頁滾動後無法快速回到搜尋框，需要大量滑動。這些操作習慣與 YouTube Music / Spotify 的 UX 模式不一致，增加使用摩擦。

## What Changes

- 歌詞 Drawer 頂部 drag handle 區域加入 touch 手勢：下拉超過 80px 閾值觸發關閉，附帶 translateY 視覺回饋
- 搜尋框改為 `position: sticky` 釘在滾動區域頂部，使用者隨時可搜尋
- 底部導航 Tab 再點同一頁時 smooth scroll 回頂部（對齊 YouTube/Spotify 行為）

## Capabilities

### New Capabilities
- `lyrics-swipe-dismiss`: 歌詞面板頂部拖曳區域支援下拉手勢關閉
- `sticky-search`: 搜尋框固定在可視區域頂部
- `tab-scroll-top`: 重複點擊同一 Tab 滾回頂部

### Modified Capabilities
_無修改現有 spec 層級行為_

## Impact

- **Frontend**: `FullscreenLyrics.tsx`（手勢處理）、`App.tsx`（sticky search + tab scroll-to-top）
- **風險**: 低。觸控手勢僅作用於 header 區域，不影響歌詞內容滾動
