# Home Media - Technical Memory

## iOS PWA & MediaSession (2026-04-07)
- **問題**: 同一域名 (.sisihome.org) 下多個 PWA 導致鎖定畫面喚回衝突。
- **決策**: 
  - 在 `manifest.webmanifest` 加入唯一 `id: "/home-media"`。
  - 將 `start_url` 改為 `/?pwa=radio` 以區分來源。
  - 修正 `sw.js` 預快取路徑，確保 manifest 正確載入。
  - 在 `visibilitychange` 回到前景時，由 `AudioPlayer` 強勢重新宣告 `MediaMetadata` 以爭奪 MediaSession 屬權。

## 影片播放與同步 (2026-04-07)
- **結構**: 實作「音軌權威 (Audio Authoritative)」同步。影片（IFrame/Video）一律靜音並跟隨音軌進度。
- **降級機制**: `FullscreenLyrics` 支援 YouTube IFrame 作為快取影片的 Fallback，並統一疊加字幕層。
- **效能優化**:
  - 放寬同步容差至 2-3 秒，避免微小漂移導致的不斷跳轉。
  - 實作「恢復鎖 (Recovery Lock)」：回到前景前 2.5 秒暫停同步，讓 Buffer 穩定。
  - 資源隔離：當歌詞抽屜開啟時，主動卸載底層 `VideoPlayer` 組件。
