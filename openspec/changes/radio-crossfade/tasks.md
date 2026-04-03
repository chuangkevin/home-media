## 1. Dual Audio Element 基礎架構

- [ ] 1.1 在 AudioPlayer.tsx 建立 secondary audio element ref（`secondaryAudioRef`），與 primary 並列
- [ ] 1.2 實作 warm up 機制：使用者首次互動時對 secondary element 播放極短靜音，繞過 autoplay 限制
- [ ] 1.3 新增 crossfade 狀態管理：`crossfadeActiveRef`、`crossfadeTimerRef`、primary/secondary 角色追蹤
- [ ] 1.4 新增 localStorage crossfade 開關讀寫（key: `radio-crossfade-enabled`）

## 2. Crossfade Engine 核心邏輯

- [ ] 2.1 實作 next track 預載：在 `track.duration - crossfadeDuration - 5` 秒時，從 IndexedDB 或 streaming URL 載入到 secondary element
- [ ] 2.2 實作 crossfade 觸發偵測：在 `handleTimeUpdate` 中檢查 `currentTime >= track.duration - crossfadeDuration`
- [ ] 2.3 實作音量漸變動畫：使用 `requestAnimationFrame` 或 `setInterval` (16ms) 線性調整兩個 element 的 volume
- [ ] 2.4 實作 element 角色交換：crossfade 完成後 secondary → primary，revoke 舊 Blob URL
- [ ] 2.5 處理短歌曲 edge case：歌曲長度 < crossfadeDuration × 2 時跳過 crossfade，使用硬切換
- [ ] 2.6 處理 crossfade 中斷：DJ 在 crossfade 進行中切到第三首歌時，立即停止兩個 element 並硬切

## 3. MediaSession 與播放狀態整合

- [ ] 3.1 Crossfade 完成時更新 MediaSession metadata 指向新 primary element
- [ ] 3.2 過渡期間 `handleTimeUpdate` 僅從 outgoing element dispatch `setCurrentTime`，完成後切換
- [ ] 3.3 SponsorBlock 整合：crossfade 期間暫停 skip segment 檢查，完成後在新 element 恢復
- [ ] 3.4 影片模式判斷：displayMode 為 video 時強制使用硬切換

## 4. Radio Sync（Host → Listener）

- [ ] 4.1 Backend `radio.handler.ts` 新增 `radio:crossfade-start` 事件處理，轉發給同電台 Listener
- [ ] 4.2 Frontend `socket.service.ts` 新增 `emitCrossfadeStart` 和 `onCrossfadeStart` 方法
- [ ] 4.3 Host 端：crossfade 觸發時 emit `radio:crossfade-start`（含 nextTrack、crossfadeDuration、elapsedMs）
- [ ] 4.4 `useRadioSync.ts` Listener 端：收到事件後執行本地 crossfade，考慮 elapsedMs 調整剩餘時間
- [ ] 4.5 Listener fallback：下一首歌未快取且 streaming 失敗時，等 crossfade 剩餘時間後硬切換

## 5. UI 控制

- [ ] 5.1 RadioPanel 新增 crossfade toggle switch（MUI Switch + label）
- [ ] 5.2 Toggle 狀態與 localStorage 雙向綁定
