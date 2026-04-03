## Why

當 AI 翻譯（Gemini）所有自動重試（4 次 × 15 秒間隔）都失敗後，使用者只能看到沒有翻譯的歌詞，無法手動重試。特別是在所有 API key 暫時冷卻的情況下，等 30 秒後手動重試通常就能成功，但目前沒有這個按鈕。

## What Changes

- 在 FullscreenLyrics 和 MorrorLyrics 中新增翻譯錯誤狀態追蹤（`translationError` + `isTranslating`）
- 自動重試全部失敗後，顯示「重試翻譯」按鈕（MUI Chip + RefreshIcon）
- 點擊重試按鈕重置 retryCount 並重新呼叫翻譯 API
- 翻譯進行中顯示 spinner，隱藏重試按鈕
- 提取 `doTranslate` 邏輯為穩定 callback 以供重試呼叫

## Capabilities

### New Capabilities
- `translation-manual-retry`: 翻譯失敗後的手動重試 UI 與邏輯

### Modified Capabilities
_無修改現有 spec 層級行為_

## Impact

- **Frontend**: `FullscreenLyrics.tsx`（主要）、`MorrorLyrics.tsx`（傳遞 retry callback）
- **風險**: 極低。純 UI 新增，不影響現有自動重試邏輯，不需 backend 修改
