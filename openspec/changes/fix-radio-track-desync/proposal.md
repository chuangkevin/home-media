## Why

電台模式下，聽眾端顯示的曲目偶爾與 DJ 實際播放的歌曲不同步。這會嚴重破壞聽眾體驗，因為畫面顯示的歌名/歌手/歌詞跟實際聽到的音樂不一致。

## What Changes

- 修復 Host 端 sync 發送：改用 `pendingTrack || currentTrack` 發送 `radio:track-change`（而非僅 `currentTrack`），讓聽眾在 DJ 點擊歌曲的瞬間就收到更新
- 修復 Listener 端 timeout race condition：15 秒超時取消前需檢查被取消的 track 是否仍為最新的 `syncTrack`，避免 DJ 快速切歌時舊 timeout 取消了新的 pending track
- 防止過渡期 null 發送：Host 在 `cancelPendingTrack` 和下一個 `setPendingTrack` 之間的短暫 null 狀態不應發送 sync 事件
- 加入 syncVersion 排序機制確保事件順序正確

## Capabilities

### New Capabilities
- `radio-track-sync`: Host/Listener 曲目同步的可靠性保證，包含 pendingTrack 感知、timeout 安全取消、版本排序

### Modified Capabilities
_無修改現有 spec 層級行為_

## Impact

- **Frontend**: `useRadioSync.ts`（主要修復）、`radioSlice.ts`（syncVersion 追蹤）
- **風險**: 修改 sync 邏輯可能影響現有電台功能的正常運作，需仔細測試快速切歌場景
