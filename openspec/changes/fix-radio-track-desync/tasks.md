## 1. Host 端 Sync 修復

- [ ] 1.1 修改 `useRadioSync.ts` Host sync effect：將 emit 來源從 `currentTrack` 改為 `pendingTrack || currentTrack`
- [ ] 1.2 新增 null guard：emit 前檢查 `(pendingTrack || currentTrack)?.videoId` 是否存在，null 時不發送
- [ ] 1.3 新增 effect dependencies：加入 `pendingTrack` 到 sync effect 的依賴陣列
- [ ] 1.4 防重複 emit：用 `prevTrackRef` 記錄上次 emit 的 videoId，相同時跳過

## 2. Listener 端 Timeout 修復

- [ ] 2.1 修改 timeout callback：觸發前檢查 `syncTrack.videoId` 是否仍與超時的 track 一致
- [ ] 2.2 將 syncTrack 的 videoId 存入 timeout closure 的比較值（避免 stale closure）
- [ ] 2.3 DJ 快速切歌時：新 syncTrack 到達時清除舊 timeout 並重新計時

## 3. SyncVersion 排序

- [ ] 3.1 `radioSlice.ts` 新增 `localSyncVersion` 計數器（Host 端每次 emit 遞增）
- [ ] 3.2 `radio:track-change` 事件 payload 加入 `syncVersion` 欄位
- [ ] 3.3 Listener 端記錄已處理的最大 `syncVersion`，忽略小於等於的事件
- [ ] 3.4 Listener 重連時重置 syncVersion 計數器為收到的版本

## 4. 驗證

- [ ] 4.1 測試場景：DJ 在 3 秒內連續切 5 首歌，Listener 最終顯示第 5 首
- [ ] 4.2 測試場景：DJ 切歌後立即取消，Listener 不會卡在舊歌
- [ ] 4.3 測試場景：Listener 斷線重連後同步到 DJ 當前歌曲
