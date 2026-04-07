## Context

目前搜尋結果與推薦清單的 `SearchResults.tsx` 組件使用 `IconButton` 作為唯一的播放觸發點，這導致操作不便。在 iOS 裝置上，同一域名 `.sisihome.org` 下的多個 PWA 會發生鎖定畫面喚回衝突。現有的 `AudioPlayer.tsx` 在 `embedded` 模式下會限制 `MediaSession` 更新，這可能導致鎖定畫面無法正確關聯到正在播放的媒體 Origin。

## Goals / Non-Goals

**Goals:**
- 將搜尋結果改為全區域點擊播放，提升操作體驗。
- 解決 iOS 鎖定畫面喚回衝突，確保點擊播放器標題能回到 `radio.sisihome.org`。
- 強化 PWA 的唯一性標識。

**Non-Goals:**
- 修改 `docker-app-portal` 的內部邏輯。
- 變更現有的音訊播放核心（如 yt-dlp 串流邏輯）。

## Decisions

### 1. 使用 MUI CardActionArea 實作全區點擊
- **理由**：與 `PlaylistSection.tsx` 保持一致，利用 `CardActionArea` 自動處理 Hover 效果與 Accessibility。
- **替代方案**：在 `Card` 上直接加 `onClick`。缺點是缺乏 MUI 原生的水波紋效果與無障礙支援。
- **事件隔離**：內層的「加入播放清單」按鈕必須呼叫 `e.stopPropagation()`，避免觸發全區播放。

### 2. PWA 唯一識別標識
- **理由**：在 `manifest.webmanifest` 中明確指定 `"id": "/home-media"` 與 `"scope": "/"`。根據 W3C 規範，`id` 是 PWA 的唯一標識符，能協助作業系統區分相同 Domain 下的不同應用程式。
- **實作**：更新 `frontend/public/manifest.webmanifest`。

### 3. 解禁 Embedded 模式的 MediaSession 更新
- **理由**：目前的邏輯 `if (embedded) return` 會阻止 `radio` 在被嵌入或域名重疊時向系統報告播放狀態。解禁後，無論是否被嵌入，`radio` 都會積極聲明 `MediaSession` 屬權。

### 4. 喚回屬權宣告 (visibilitychange)
- **理由**：當使用者從鎖定畫面「嘗試回到 App」時，如果系統誤喚回 `portal`，表示 `portal` 的 PWA 攔截了該事件。我們需要在 `radio` 被開啟或回到前景時，強制觸發一次 `navigator.mediaSession.metadata` 更新，以宣告「目前的主控權在我這」。

### 5. 影片同步效能優化 (Performance Sync)
- **容差放寬**：將同步漂移容差從 1s 放寬至 2-3s。減少因網路微小波動導致的頻繁 `seekTo`（即跳轉轉圈）。
- **恢復保護 (Recovery Lock)**：在 `visibilitychange` 偵測到應用程式回到前景時，暫停影片同步 2.5 秒。這給予 YouTube IFrame 與系統資源足夠的緩衝期來穩定連線，避免喚醒時的持續卡頓。
- **渲染隔離**：在 `App.tsx` 中監聽 `lyricsDrawerOpen`，當歌詞抽屜打開時主動卸載底層 `VideoPlayer` 組件，確保同一時間全域僅有一個 YouTube IFrame 實例，節省 CPU 與頻寬。

## Risks / Trade-offs

- [Risk]：全區域點擊可能導致誤觸。
  - Mitigation：卡片內的其他功能按鈕（如加入清單）需明顯區分，並確保 `stopPropagation` 正確。
- [Risk]：多個 MediaSession 競爭可能導致 iOS 系統不穩定。
  - Mitigation：遵循前人的 `visibilitychange` 與 `wasCompletedRef` 邏輯，避免重複觸發 API 調用。
