## Why

當使用者在一台裝置上調整歌詞偏移或切換歌詞來源時，其他裝置不會即時更新，必須重新載入歌曲才能看到變更。在多裝置使用場景（如手機調歌詞、電視看歌詞）中，需要任何人改動歌詞後即時通知所有連線裝置。

## What Changes

- Backend 新增 `lyrics.handler.ts` socket handler，處理歌詞變更事件的廣播
- 任何歌詞修改（偏移調整、歌詞來源切換）都透過 Socket.io (port 3002) 廣播給所有其他連線裝置
- 不限於電台模式 — 任何連線裝置都會收到更新
- 接收端若正在播放同一首歌，即時套用新的偏移/重新載入歌詞
- 防止無限循環：收到遠端更新後不會再次廣播（`isRemoteUpdate` flag + deviceId 過濾）
- 現有 REST API `updateLyricsPreferences` 保留做持久化；Socket 僅做即時推送
- 後來上線的裝置照舊從 REST API 載入偏好設定

## Capabilities

### New Capabilities
- `lyrics-socket-broadcast`: 歌詞變更的 Socket.io 廣播機制（偏移、來源切換）
- `lyrics-remote-apply`: 前端接收遠端歌詞變更並即時套用，含防迴圈機制

### Modified Capabilities
_無修改現有 spec 層級行為_

## Impact

- **Backend**: `lyrics.handler.ts`（新檔案）、`server.ts`（註冊 handler）
- **Frontend**: `socket.service.ts`（新方法）、`useLyricsSync.ts`（新 hook）、`LyricsView.tsx`、`FullscreenLyrics.tsx`（觸發 emit）
- **風險**: emit → receive → re-emit 無限循環（需 isRemoteUpdate guard）、多人同時調整同一首歌的 last-write-wins 衝突
