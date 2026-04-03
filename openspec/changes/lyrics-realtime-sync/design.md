## Context

歌詞系統支援偏移調整（fine-tune）和來源切換（LRCLIB/NetEase/Genius 等）。修改後透過 REST API `updateLyricsPreferences` 存到 backend SQLite。其他裝置需重新載入歌曲才能看到變更。

Socket.io 已在 port 3002 運行，有 radio 和 casting handlers。前端有 `socket.service.ts` 統一管理 socket 連線。

使用者需求：「有人改動歌詞，即時給大家」— 不限電台模式，任何連線裝置都應收到。

## Goals / Non-Goals

**Goals:**
- 任何歌詞修改（偏移、來源切換）即時廣播到所有連線裝置
- 接收端正在播放同一首歌時即時套用
- 防止 emit → receive → re-emit 無限循環
- 與現有 REST API 持久化並存

**Non-Goals:**
- 不做歌詞文字內容的即時編輯同步（僅偏移和來源）
- 不做衝突解決（last-write-wins）
- 不修改 REST API 行為

## Decisions

### 1. 廣播範圍：所有連線裝置
**選擇**: 使用 `socket.broadcast.emit`（發送給除自己以外的所有連線）而非限定電台房間。

**理由**: 使用者需求明確「有人改動，即時給大家」。同一使用者可能有手機+電視+電腦同時開著。

### 2. 防迴圈機制：deviceId + isRemoteUpdate flag
**選擇**: 每個事件 payload 包含 `deviceId`（前端啟動時產生 UUID）。接收端設 `isRemoteUpdate = true` flag，套用變更時跳過 emit。

**替代方案**: 僅用 deviceId 過濾 — 不夠，因 broadcast.emit 已排除自己，但 reducer 觸發的 side effect 可能意外 re-emit。雙重保護更安全。

### 3. 事件類型分離
**選擇**: 分為兩個事件：
- `lyrics:offset-update` / `lyrics:offset-changed`（偏移調整）
- `lyrics:source-update` / `lyrics:source-changed`（來源切換）

**理由**: 接收端處理邏輯不同。偏移僅需 dispatch `setTimeOffset`；來源切換需重新載入整份歌詞。

### 4. 新 hook `useLyricsSync.ts`
**選擇**: 建立獨立 hook 統一管理歌詞 socket 邏輯（emit + listen），在 LyricsView 和 FullscreenLyrics 中使用。

**理由**: 避免在多個元件中重複 socket 邏輯。

### 5. REST API 保留做持久化
**選擇**: Socket 僅做即時推送，不取代 REST API。修改歌詞時同時呼叫 REST API（存 DB）+ Socket emit（即時通知）。

**理由**: 後來上線的裝置需要從 DB 讀取最新偏好，不能僅依賴 socket。

## Risks / Trade-offs

- **[無限循環]** emit → receive → re-emit → 使用 isRemoteUpdate flag + deviceId 雙重防護
- **[Last-write-wins]** 兩人同時調整 → 可接受，家用場景衝突極少
- **[Listener 未播放同首歌]** 收到事件但 videoId 不匹配 → 忽略，不存本地（下次播放時從 REST API 讀取最新值）
