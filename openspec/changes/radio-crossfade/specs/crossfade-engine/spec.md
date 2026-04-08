## ADDED Requirements

### Requirement: Dual audio element lifecycle
系統 SHALL 維護兩個 `<audio>` element（primary 和 secondary），在電台模式啟用 crossfade 時使用。非電台模式或 crossfade 關閉時，僅使用 primary element。

#### Scenario: Crossfade mode enabled
- **WHEN** 使用者開啟電台模式且 crossfade 設定為開啟
- **THEN** 系統 SHALL 建立並 warm up secondary audio element（播放極短靜音以繞過 autoplay 限制）

#### Scenario: iPhone standalone PWA local playback
- **WHEN** 使用者在 iPhone standalone PWA 中進行本地播放，且目前不是 radio host / listener
- **THEN** 系統 SHALL 自動允許 tail-end crossfade 使用 secondary audio element
- **AND** 不需要額外顯示 radio crossfade 開關

#### Scenario: Crossfade mode disabled
- **WHEN** crossfade 設定關閉或非電台模式
- **THEN** 系統 SHALL 僅使用 primary audio element，secondary element 不載入任何音源

### Requirement: Crossfade volume animation
系統 SHALL 在歌曲接近結尾時（`currentTime >= track.duration - crossfadeDuration`），對 primary element 執行音量從 1.0 → 0.0 的線性漸變，同時對 secondary element 執行 0.0 → 1.0 的線性漸變。crossfadeDuration 預設為 5 秒。

#### Scenario: Normal crossfade transition
- **WHEN** currentTime 到達 `track.duration - 5` 秒
- **THEN** primary element 音量從 1.0 線性降至 0.0，secondary element 音量從 0.0 線性升至 1.0，歷時 5 秒

#### Scenario: Track shorter than crossfade duration
- **WHEN** 歌曲總長度小於 crossfadeDuration 的 2 倍
- **THEN** 系統 SHALL 跳過 crossfade，使用硬切換

### Requirement: Element role swap
Crossfade 完成後，系統 SHALL 交換兩個 element 的角色：secondary 變為 primary，原 primary 停止並釋放資源。

#### Scenario: Crossfade completes
- **WHEN** crossfade 動畫完成（outgoing volume = 0, incoming volume = 1）
- **THEN** incoming element 成為新的 primary，舊 primary 停止播放並 revoke 其 Blob URL

### Requirement: Next track preload on secondary
系統 SHALL 在 crossfade 觸發前預載下一首歌到 secondary element。預載時機為歌曲播放至 `track.duration - crossfadeDuration - 5` 秒（crossfade 開始前 5 秒）。

#### Scenario: Next track available in cache
- **WHEN** 下一首歌已在 IndexedDB 快取中
- **THEN** 系統 SHALL 從快取建立 Blob URL 並設為 secondary element 的 src

#### Scenario: Next track not cached
- **WHEN** 下一首歌不在快取中
- **THEN** 系統 SHALL 使用 streaming URL 作為 secondary element 的 src，若載入失敗則 fallback 為硬切換

#### Scenario: iPhone local playback avoids hard cut
- **WHEN** iPhone standalone PWA 的本地播放接近歌曲尾段
- **THEN** 系統 SHALL 先把下一首歌載入 secondary audio，再開始 crossfade
- **AND** 不應等到 `ended` 後才重新指定 primary audio 的 `src`

### Requirement: MediaSession update timing
系統 SHALL 在 crossfade 完成的瞬間（非開始時）更新 MediaSession metadata 為新歌曲資訊。

#### Scenario: Lock screen display during crossfade
- **WHEN** crossfade 正在進行中
- **THEN** 鎖屏 SHALL 仍顯示舊歌曲資訊，直到 crossfade 完成才切換

### Requirement: Crossfade interruption
當 crossfade 進行中 DJ 切到第三首歌時，系統 SHALL 立即取消 crossfade，硬切到最新歌曲。

#### Scenario: DJ skips during crossfade
- **WHEN** crossfade 正在 A→B 過渡中，DJ 點擊播放歌曲 C
- **THEN** 系統 SHALL 立即停止 A 和 B，在 primary element 播放 C（無 crossfade）

### Requirement: Crossfade toggle persistence
使用者 SHALL 能在 RadioPanel 或設定中開關 crossfade，偏好存於 localStorage。

#### Scenario: Toggle crossfade
- **WHEN** 使用者切換 crossfade 開關
- **THEN** 偏好 SHALL 立即存入 localStorage 並生效，不需重新載入頁面
