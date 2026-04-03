## ADDED Requirements

### Requirement: Host sync uses pendingTrack priority
Host SHALL 使用 `pendingTrack || currentTrack` 作為 `radio:track-change` 事件的 track 來源，確保 Listener 在 DJ 點擊歌曲的瞬間就收到更新。

#### Scenario: DJ clicks new song
- **WHEN** DJ 點擊播放一首新歌曲（setPendingTrack 被呼叫）
- **THEN** Host SHALL 立即發送 `radio:track-change` 事件，track 資料來自 pendingTrack

#### Scenario: PendingTrack confirmed
- **WHEN** pendingTrack 被 confirmPendingTrack 確認為 currentTrack
- **THEN** Host SHALL 不重複發送 `radio:track-change`（因 videoId 未變）

### Requirement: Null track guard
Host SHALL 不發送 track 為 null 的 `radio:track-change` 事件。

#### Scenario: Transition null state
- **WHEN** Host 在 cancelPendingTrack 和下一個 setPendingTrack 之間
- **THEN** Host SHALL 不發送任何 `radio:track-change` 事件

### Requirement: Listener timeout safety
Listener 的 pending track timeout（15 秒）SHALL 在觸發前檢查被超時的 track 是否仍為最新的 syncTrack。

#### Scenario: DJ skips rapidly
- **WHEN** DJ 在 5 秒內連續切換 3 首歌
- **THEN** 只有最後一首歌的 pending track 保留，前兩首的 timeout 不觸發 cancelPendingTrack

#### Scenario: Genuine load failure
- **WHEN** 一首歌的 pending track 超過 15 秒仍未確認，且 syncTrack.videoId 仍為同一首
- **THEN** timeout SHALL 正常觸發 cancelPendingTrack

### Requirement: SyncVersion ordering
每個 `radio:track-change` 事件 SHALL 包含遞增的 `syncVersion` 數字。Listener SHALL 忽略 syncVersion 小於等於已處理版本的事件。

#### Scenario: Out-of-order events
- **WHEN** Listener 收到 syncVersion=5 的事件後又收到 syncVersion=3 的事件
- **THEN** Listener SHALL 忽略 syncVersion=3 的事件

#### Scenario: Reconnection resync
- **WHEN** Listener 重新連線並收到最新的 station state
- **THEN** Listener SHALL 重置 syncVersion 計數器為收到的版本
