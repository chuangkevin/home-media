## ADDED Requirements

### Requirement: Host emits crossfade-start event
Host (DJ) SHALL 在 crossfade 開始時透過 Socket.io 發送 `radio:crossfade-start` 事件，payload 包含 `{ nextTrack, crossfadeDuration, elapsedMs }`。

#### Scenario: Host begins crossfade
- **WHEN** Host 端 crossfade 開始觸發
- **THEN** 系統 SHALL 發送 `radio:crossfade-start` 事件給所有 Listener，包含下一首歌的 track 資訊、crossfade 總時長、以及已經過的毫秒數

### Requirement: Listener local crossfade
Listener 收到 `radio:crossfade-start` 事件後，SHALL 在本地執行相同的 crossfade 動畫。若下一首歌尚未快取且 streaming 載入失敗，fallback 為硬切換。

#### Scenario: Listener has next track cached
- **WHEN** Listener 收到 `radio:crossfade-start` 且下一首歌在 IndexedDB 中
- **THEN** Listener SHALL 從快取載入並執行 crossfade，考慮 `elapsedMs` 調整剩餘 crossfade 時間

#### Scenario: Listener next track not available
- **WHEN** Listener 收到 `radio:crossfade-start` 但無法載入下一首歌
- **THEN** Listener SHALL 等待 crossfade 剩餘時間結束後硬切換到下一首歌

### Requirement: Backend crossfade event relay
Backend SHALL 在 `radio.handler.ts` 中處理 `radio:crossfade-start` 事件，轉發給同一電台的所有 Listener（不包括 Host 自身）。

#### Scenario: Crossfade event broadcast
- **WHEN** Backend 收到 Host 的 `radio:crossfade-start` 事件
- **THEN** Backend SHALL 使用 `socket.to(stationRoom).emit()` 轉發給該電台的所有 Listener

### Requirement: Video mode crossfade exclusion
影片模式下 SHALL 停用 crossfade，即使 crossfade 設定為開啟。

#### Scenario: Video display mode active
- **WHEN** displayMode 為 video 且 crossfade 觸發時機到達
- **THEN** 系統 SHALL 使用硬切換而非 crossfade
