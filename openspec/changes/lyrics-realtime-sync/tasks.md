## 1. Backend Socket Handler

- [ ] 1.1 建立 `backend/src/handlers/lyrics.handler.ts`，處理 `lyrics:offset-update` 和 `lyrics:source-update` 事件
- [ ] 1.2 收到事件時使用 `socket.broadcast.emit` 轉發給除發送者以外的所有連線
- [ ] 1.3 在 `server.ts` 中註冊 lyrics handler（與 radio、casting handlers 並列）

## 2. Frontend Socket Service

- [ ] 2.1 `socket.service.ts` 新增 `emitLyricsOffsetUpdate(videoId, timeOffset, deviceId)` 方法
- [ ] 2.2 `socket.service.ts` 新增 `emitLyricsSourceUpdate(videoId, source, sourceId, deviceId)` 方法
- [ ] 2.3 `socket.service.ts` 新增 `onLyricsOffsetChanged` 和 `onLyricsSourceChanged` 事件監聽註冊

## 3. Device ID 與防迴圈

- [ ] 3.1 在 socket.service.ts 或獨立 util 中實作 deviceId 產生：首次啟動產生 UUID v4 存 sessionStorage
- [ ] 3.2 所有歌詞 emit 自動帶入 deviceId

## 4. useLyricsSync Hook

- [ ] 4.1 建立 `frontend/src/hooks/useLyricsSync.ts` hook
- [ ] 4.2 實作 `emitOffsetUpdate(videoId, timeOffset)` — 帶入 deviceId、設 isRemoteUpdate = false
- [ ] 4.3 實作 `emitSourceUpdate(videoId, source, sourceId)` — 同上
- [ ] 4.4 監聽 `lyrics:offset-changed`：videoId 匹配時 dispatch `setTimeOffset`，設 `isRemoteUpdate = true` 防 re-emit
- [ ] 4.5 監聽 `lyrics:source-changed`：videoId 匹配時觸發歌詞重新載入
- [ ] 4.6 cleanup：component unmount 時移除 socket 監聽

## 5. 整合到現有元件

- [ ] 5.1 LyricsView.tsx：偏移調整（handleConfirmFineTune、handleOffsetIncrease/Decrease/Reset）後呼叫 `emitOffsetUpdate`
- [ ] 5.2 LyricsView.tsx：歌詞來源切換後呼叫 `emitSourceUpdate`
- [ ] 5.3 FullscreenLyrics.tsx：同 5.1 + 5.2 的偏移和來源變更觸發 emit
- [ ] 5.4 接收端套用偏移時跳過 emit（檢查 isRemoteUpdate flag）
