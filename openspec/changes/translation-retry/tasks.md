## 1. 狀態與邏輯重構

- [ ] 1.1 在 FullscreenLyrics.tsx 新增 `translationError` 和 `isTranslating` state
- [ ] 1.2 提取翻譯邏輯為 `doTranslate` useCallback，供 effect 和 retry button 共用
- [ ] 1.3 自動重試全部失敗（retryCount >= 4）時設 `translationError = true`、`isTranslating = false`
- [ ] 1.4 翻譯成功時設 `translationError = false`、`isTranslating = false`
- [ ] 1.5 歌曲切換時重置 `translationError = false`

## 2. 重試 UI

- [ ] 2.1 在歌詞區域新增重試按鈕：`translationError && !isTranslating` 時顯示 MUI Chip（RefreshIcon + "重試翻譯"）
- [ ] 2.2 翻譯進行中顯示 CircularProgress spinner 取代重試按鈕
- [ ] 2.3 重試按鈕 onClick：重置 retryCount = 0、translationError = false，呼叫 doTranslate()

## 3. MorrorLyrics 支援

- [ ] 3.1 FullscreenLyrics 傳遞 `onRetryTranslation` callback prop 給 MorrorLyrics
- [ ] 3.2 MorrorLyrics 接收 `translationError`、`isTranslating`、`onRetryTranslation` props
- [ ] 3.3 MorrorLyrics 在適當位置顯示重試按鈕（與沉浸模式視覺風格一致：白字黑邊）
