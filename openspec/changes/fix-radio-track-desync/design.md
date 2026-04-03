## Context

電台模式中，Host 播放歌曲的生命週期為 `pendingTrack` → `confirmPendingTrack()` → `currentTrack`。目前 `useRadioSync.ts` 監聽 `currentTrack` 變化來發送 `radio:track-change` 事件。問題在於 `currentTrack` 更新有延遲（需等 pending 確認），且過渡期可能出現 null 值。

Listener 端收到 sync 後執行 `setPendingTrack` + 15 秒 timeout 取消機制，但 DJ 快速切歌時舊 timeout 會錯誤取消新 track。

## Goals / Non-Goals

**Goals:**
- Host 點擊歌曲的瞬間 Listener 就收到更新（不等 pending 確認）
- DJ 快速切歌時 Listener 始終顯示最新歌曲
- 防止過渡期 null track 被發送
- 確保事件順序正確

**Non-Goals:**
- 不修改 pendingTrack/currentTrack 生命週期本身
- 不修改 radio sync 的播放位置同步
- 不處理網路斷線重連的同步（已有其他機制）

## Decisions

### 1. Host emit 使用 pendingTrack || currentTrack
**選擇**: 修改 `useRadioSync.ts` 的 sync effect，emit 時使用 `pendingTrack || currentTrack` 取代僅 `currentTrack`。

**理由**: 與 auto-queue seed 使用相同 pattern（CLAUDE.md 已記載）。pendingTrack 在 DJ 點擊歌曲的瞬間就設定，比 currentTrack 快數秒。

### 2. Listener timeout 加入 syncVersion 檢查
**選擇**: 在 timeout callback 中檢查 `syncTrack.videoId` 是否仍與超時的 track 一致，不一致則不取消。

**替代方案**: 移除 timeout 機制 — 棄選，因某些情況下 track 確實載入失敗需要清理。

### 3. Null guard
**選擇**: Host emit 前檢查 `(pendingTrack || currentTrack)?.videoId` 是否存在，null 時不發送事件。

**理由**: 簡單有效，防止過渡期清空 Listener 顯示。

## Risks / Trade-offs

- **[emit 頻率增加]** 監聽 pendingTrack 會多觸發一次 emit（pending 設定時 + current 確認時）→ 在 Listener 端用 `syncTrack.videoId !== currentTrack?.videoId` 過濾重複
- **[pendingTrack 取消]** DJ 點了歌但取消 → 不常見，且 Listener 會在下次 sync 修正
