# Capability Spec: track-card-interaction

## Context
目前的曲目卡片只有播放按鈕可點擊，不符合用戶習慣。我們需要統一全應用的點擊行為。

## Requirements
1.  **全區域點擊 (Full-area Click)**：
    -   搜尋結果 (`SearchResults.tsx`) 與推薦列表中的 `Card` 必須使用 `CardActionArea` 包裝。
    -   點擊 `CardActionArea` 應觸發播放功能（執行 `onPlay(track)`）。
2.  **事件隔離 (Event Propagation Isolation)**：
    -   卡片內部的非播放按鈕（如「加入佇列」、「加入播放清單」）必須在點擊時呼叫 `e.stopPropagation()`。
    -   確保點擊這些按鈕時不會觸發全區域的 `onClick` (播放) 事件。
3.  **視覺回饋 (Visual Feedback)**：
    -   點擊時應顯示原生的 MUI Ripple (水波紋) 效果。
    -   Hover 時應有明顯的陰影加強或背景變色。

## Success Criteria
- [ ] 點擊搜尋結果卡片的文字或圖片區域，音樂開始播放。
- [ ] 點擊卡片內的「加入清單」按鈕，成功開啟清單選單，且音樂**不**會播放。
