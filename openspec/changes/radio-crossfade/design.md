## Context

目前電台模式使用單一 `<audio>` element，歌曲結束時直接切換到下一首（硬切）。AudioPlayer.tsx 是核心播放元件，所有播放控制、MediaSession、SponsorBlock 都圍繞這個單一 audio element。Socket.io 已有 radio sync 機制（`useRadioSync.ts`），Host 透過 `radio:track-change` 通知 Listener。

音訊架構原則（CLAUDE.md）：audio element 是唯一音源，iframe/video 永遠靜音。Crossfade 在過渡期間會短暫有兩個音源，這是可接受的例外。

## Goals / Non-Goals

**Goals:**
- 電台模式下歌曲過渡使用 crossfade（預設 5 秒），聽眾感受到兩首歌交融
- Host 和 Listener 都能執行 crossfade 動畫
- 可開關，偏好存 localStorage
- 正確處理 MediaSession（鎖屏顯示）切換

**Non-Goals:**
- 一般播放模式不加 crossfade
- 影片模式不支援 crossfade
- 不使用 Web Audio API（CORS 問題）
- 不做 gapless playback（只做 crossfade）

## Decisions

### 1. 雙 `<audio>` element + 程式化音量控制
**選擇**: 建立兩個 `<audio>` element（A/B），用 `element.volume` 做線性漸變，crossfade 完成後交換角色。

**替代方案**: Web Audio API `GainNode` — 棄選，因行動裝置 CORS 限制（MorrorLyrics visualizer 已有此問題需 fallback）。

**理由**: 雙 element 方案簡單、無 CORS 問題，且 `volume` 屬性在所有瀏覽器都支援。

### 2. Crossfade 觸發時機
**選擇**: 當 `currentTime >= track.duration - CROSSFADE_DURATION` 時啟動。使用 `track.duration`（YouTube metadata）而非 `audio.duration`（含尾部靜音）。

**理由**: 與現有架構一致（CLAUDE.md 已指出 tail silence 問題）。

### 3. 第二個 audio element 的 autoplay 限制處理
**選擇**: 在使用者首次與頁面互動時就建立並 warm up 第二個 audio element（播放一段極短靜音），確保後續 programmatic play 不被瀏覽器封鎖。

**替代方案**: 每次 crossfade 時才建立新 element — 棄選，行動裝置會因 autoplay policy 封鎖。

### 4. Host → Listener 同步
**選擇**: Host 在 crossfade 開始時發送 `radio:crossfade-start` 事件（含 nextTrack info + crossfade duration + 已經過的時間）。Listener 收到後在本地執行 crossfade。若 Listener 尚未快取下一首歌，fallback 為硬切換。

**替代方案**: 讓 Listener 自行偵測歌曲快結束 — 棄選，因 Host 和 Listener 的 currentTime 不保證同步。

### 5. MediaSession 切換
**選擇**: Crossfade 完成的瞬間（而非開始時）更新 MediaSession metadata 指向新的 active element。這確保鎖屏顯示在過渡完成後才切換歌曲資訊。

## Risks / Trade-offs

- **[記憶體]** 兩個 Blob URL 同時載入 → 過渡完成後立即 revoke 舊 Blob URL
- **[SponsorBlock]** Skip segment 必須套用到正確的 audio element → crossfade 期間暫停 SponsorBlock 檢查，完成後在新 element 上恢復
- **[行動裝置 autoplay]** 第二個 element 可能被封鎖 → warm up 機制 + fallback 硬切換
- **[快速切歌]** DJ 在 crossfade 進行中又切歌 → 立即取消當前 crossfade，直接硬切到最新歌曲
- **[handleTimeUpdate]** 過渡期間兩個 element 都在播放 → 只從 outgoing element dispatch `setCurrentTime`，切換後改為 incoming element
