## Context

AI 翻譯使用 Gemini 2.5 Flash，最多 41 個 API key 隨機選取。自動重試機制為 4 次 × 15 秒間隔。所有 key 都 bad 時會 `badKeys.clear()` 重置。翻譯結果快取在 `lyrics_translations` table（僅快取成功結果）。

目前自動重試全部失敗後，翻譯狀態停留在空陣列 `[]`，使用者無法手動觸發重試。

## Goals / Non-Goals

**Goals:**
- 自動重試全部失敗後顯示手動重試按鈕
- 翻譯進行中顯示 loading 狀態
- 一鍵重試，不需刷新頁面

**Non-Goals:**
- 不修改自動重試邏輯（4 次 × 15 秒）
- 不修改 backend 翻譯 API
- 不新增「強制重新翻譯」（清除快取）功能

## Decisions

### 1. State management in component
**選擇**: 在 FullscreenLyrics.tsx 新增 `translationError: boolean` 和 `isTranslating: boolean` state，不放 Redux。

**理由**: 翻譯狀態是 UI-local concern，僅在歌詞全螢幕/沉浸模式中使用，無需跨元件共享。

### 2. 提取 doTranslate callback
**選擇**: 將翻譯邏輯提取為 `doTranslate` 函式（useCallback），供 effect 和 retry button 共用。

**理由**: 避免重複程式碼，確保重試路徑與自動路徑行為一致。

### 3. MorrorLyrics 透過 prop 接收
**選擇**: MorrorLyrics 從 FullscreenLyrics 接收 `onRetryTranslation` callback prop。

**理由**: MorrorLyrics 是 FullscreenLyrics 的子元件/同層元件，翻譯狀態管理統一在 FullscreenLyrics。

## Risks / Trade-offs

- **[極低風險]** 純 UI 新增，不影響現有自動重試或 backend
- **[effect cleanup]** track 切換時 `cancelled` flag 會取消進行中的重試 → 這是正確行為
