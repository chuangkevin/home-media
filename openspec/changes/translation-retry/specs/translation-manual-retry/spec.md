## ADDED Requirements

### Requirement: Translation error state tracking
系統 SHALL 追蹤翻譯狀態：idle、translating、success、error。自動重試全部失敗（4 次）後狀態轉為 error。

#### Scenario: All auto retries exhausted
- **WHEN** 4 次自動重試全部失敗
- **THEN** translationError SHALL 設為 true，isTranslating SHALL 設為 false

#### Scenario: Translation succeeds on retry 2
- **WHEN** 第 2 次自動重試成功取得翻譯
- **THEN** translationError SHALL 保持 false，translations SHALL 填入結果

### Requirement: Retry button display
當 translationError 為 true 且 translations 為空時，系統 SHALL 顯示「重試翻譯」按鈕（MUI Chip + RefreshIcon）。

#### Scenario: Show retry button after failure
- **WHEN** 所有自動重試失敗
- **THEN** 歌詞區域 SHALL 顯示可點擊的「重試翻譯」Chip

#### Scenario: Hide retry button during translation
- **WHEN** isTranslating 為 true
- **THEN** 系統 SHALL 顯示 loading spinner 而非重試按鈕

#### Scenario: Hide retry button on success
- **WHEN** 翻譯成功（translations 非空）
- **THEN** 重試按鈕 SHALL 不顯示

### Requirement: Manual retry action
點擊重試按鈕 SHALL 重置 retryCount 為 0 並重新呼叫 doTranslate()，與自動重試使用相同的翻譯路徑。

#### Scenario: User clicks retry
- **WHEN** 使用者點擊「重試翻譯」按鈕
- **THEN** 系統 SHALL 設 isTranslating = true、translationError = false，並呼叫翻譯 API

#### Scenario: Manual retry also fails
- **WHEN** 手動重試後自動重試再次全部失敗
- **THEN** 系統 SHALL 再次顯示重試按鈕（使用者可無限重試）

### Requirement: Track change cancellation
當歌曲切換時，進行中的手動重試 SHALL 被取消（不影響新歌曲的翻譯流程）。

#### Scenario: Track changes during retry
- **WHEN** 手動重試進行中，使用者切換到下一首歌
- **THEN** 舊歌曲的翻譯請求 SHALL 被 cancelled flag 中止，新歌曲獨立開始翻譯流程

### Requirement: MorrorLyrics retry support
MorrorLyrics（沉浸模式）SHALL 支援顯示重試按鈕，透過 callback prop 觸發重試。

#### Scenario: Retry in immersive mode
- **WHEN** 使用者在沉浸歌詞模式中看到翻譯失敗
- **THEN** SHALL 顯示與 FullscreenLyrics 相同的重試按鈕
