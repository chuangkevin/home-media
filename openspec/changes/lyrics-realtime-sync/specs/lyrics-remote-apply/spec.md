## ADDED Requirements

### Requirement: Remote offset apply
當前端收到 `lyrics:offset-changed` 事件且 videoId 匹配當前播放歌曲時，系統 SHALL 即時套用新的偏移值。

#### Scenario: Same song playing
- **WHEN** 收到 `lyrics:offset-changed` 且 videoId 等於當前播放歌曲的 videoId
- **THEN** 系統 SHALL dispatch `setTimeOffset(newOffset)` 更新歌詞偏移

#### Scenario: Different song playing
- **WHEN** 收到 `lyrics:offset-changed` 但 videoId 不等於當前播放歌曲的 videoId
- **THEN** 系統 SHALL 忽略此事件（不存本地，下次播放時從 REST API 讀取）

### Requirement: Remote source apply
當前端收到 `lyrics:source-changed` 事件且 videoId 匹配當前播放歌曲時，系統 SHALL 重新載入歌詞。

#### Scenario: Source changed for current song
- **WHEN** 收到 `lyrics:source-changed` 且 videoId 等於當前播放歌曲的 videoId
- **THEN** 系統 SHALL 重新呼叫 getLyrics 載入新來源的歌詞

#### Scenario: Source changed for different song
- **WHEN** 收到 `lyrics:source-changed` 但 videoId 不等於當前播放歌曲的 videoId
- **THEN** 系統 SHALL 忽略此事件

### Requirement: Stale lyrics requests SHALL NOT overwrite the active song
當歌曲切換後，任何舊歌曲的歌詞請求、延遲重試、或慢回應都 SHALL NOT 覆蓋當前歌曲的歌詞、錯誤狀態或 loading state。

#### Scenario: Previous song lyrics resolve late
- **WHEN** 歌曲 A 的歌詞請求仍在進行中，而播放器已切到歌曲 B
- **THEN** 歌曲 A 的成功結果 SHALL 被丟棄，不得 dispatch 成為歌曲 B 的 currentLyrics

#### Scenario: Previous song retry resolves after switch
- **WHEN** 歌曲 A 的 15 秒重試在切到歌曲 B 之後才回來
- **THEN** 歌曲 A 的結果與錯誤/loading 更新 SHALL 都被忽略

#### Scenario: Continuous stream SSE lyrics arrive for the old song
- **WHEN** continuous-player 模式下，SSE 的 `track-change` 已切到歌曲 B，但歌曲 A 的 `lyrics` 事件稍後才到
- **THEN** 歌曲 A 的 lyrics event SHALL 被忽略，且 `track-change` 當下應先清掉舊歌詞內容

### Requirement: Anti-loop protection
收到遠端歌詞事件後套用變更時，系統 SHALL NOT 再次 emit socket 事件，防止無限循環。

#### Scenario: Remote update does not re-emit
- **WHEN** 系統收到遠端 offset 更新並 dispatch setTimeOffset
- **THEN** 系統 SHALL 設定 `isRemoteUpdate = true` flag，跳過該次變更的 socket emit

#### Scenario: Local update emits normally
- **WHEN** 使用者在本地手動調整偏移
- **THEN** 系統 SHALL 正常 emit socket 事件（isRemoteUpdate 為 false）

### Requirement: Device identification
前端 SHALL 在啟動時產生唯一 `deviceId`（UUID v4），存於 sessionStorage，用於所有歌詞 socket 事件。

#### Scenario: Device ID generation
- **WHEN** 前端首次啟動且 sessionStorage 無 deviceId
- **THEN** 系統 SHALL 產生 UUID v4 並存入 sessionStorage

#### Scenario: Device ID persistence within session
- **WHEN** 頁面重新整理
- **THEN** 系統 SHALL 從 sessionStorage 讀取既有 deviceId（同一分頁保持同一 ID）

### Requirement: useLyricsSync hook
前端 SHALL 提供 `useLyricsSync` hook，統一管理歌詞 socket 的 emit 和 listen 邏輯。

#### Scenario: Hook provides emit functions
- **WHEN** 元件使用 useLyricsSync hook
- **THEN** hook SHALL 提供 `emitOffsetUpdate(videoId, timeOffset)` 和 `emitSourceUpdate(videoId, source, sourceId)` 函式

#### Scenario: Hook auto-listens for changes
- **WHEN** 元件掛載 useLyricsSync hook
- **THEN** hook SHALL 自動監聽 `lyrics:offset-changed` 和 `lyrics:source-changed` 事件並根據 videoId 匹配決定是否套用
