## ADDED Requirements

### Requirement: Lyrics offset broadcast
當任何使用者修改歌詞偏移時，系統 SHALL 透過 Socket.io 廣播 `lyrics:offset-changed` 事件給所有其他連線裝置。

#### Scenario: User adjusts offset
- **WHEN** 使用者透過 fine-tune 確認、+/- 按鈕、或重置偏移
- **THEN** 前端 SHALL emit `lyrics:offset-update` 事件，payload 為 `{ videoId, timeOffset, deviceId }`
- **THEN** Backend SHALL 廣播 `lyrics:offset-changed` 給除發送者以外的所有連線

#### Scenario: Backend relay
- **WHEN** Backend 收到 `lyrics:offset-update` 事件
- **THEN** Backend SHALL 使用 `socket.broadcast.emit('lyrics:offset-changed', payload)` 轉發

### Requirement: Lyrics source broadcast
當任何使用者切換歌詞來源時，系統 SHALL 透過 Socket.io 廣播 `lyrics:source-changed` 事件給所有其他連線裝置。

#### Scenario: User switches lyrics source
- **WHEN** 使用者選擇不同的歌詞來源（LRCLIB/NetEase/Genius 等）
- **THEN** 前端 SHALL emit `lyrics:source-update` 事件，payload 為 `{ videoId, source, sourceId, deviceId }`
- **THEN** Backend SHALL 廣播 `lyrics:source-changed` 給除發送者以外的所有連線

### Requirement: Event payload structure
所有歌詞 socket 事件 SHALL 包含 `deviceId` 欄位（前端啟動時產生的 UUID），用於防迴圈識別。

#### Scenario: Payload includes deviceId
- **WHEN** 前端 emit 任何歌詞事件
- **THEN** payload MUST 包含非空的 `deviceId` 字串

### Requirement: Backend handler registration
Backend SHALL 在 `server.ts` 中註冊 `lyrics.handler.ts`，與既有的 radio 和 casting handlers 並列。

#### Scenario: Server startup
- **WHEN** Backend 啟動並初始化 Socket.io
- **THEN** lyrics handler SHALL 被註冊並開始監聽 `lyrics:offset-update` 和 `lyrics:source-update` 事件
