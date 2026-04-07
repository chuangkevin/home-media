## Why

用戶反映目前的搜尋結果與推薦清單必須精準點擊「播放按鈕」才能播放，這與主流音樂應用（如 Spotify/YouTube Music）的點擊整塊區域即可播放的習慣不符。此外，在 iOS 裝置上安裝多個 `.sisihome.org` 域名的 PWA（如 `radio` 與 `portal`）時，鎖定畫面點擊播放器標題會誤喚回 `portal.sisihome.org` 導致黑畫面，這嚴重影響了 PWA 的使用體驗。

## What Changes

- **全區域點擊播放**：搜尋結果 (`SearchResults.tsx`) 的曲目卡片改為全區域可點擊觸發播放。
- **MediaSession 隔離優化**：移除 `embedded` 模式下不更新 `MediaSession` 的限制，確保即使被嵌入也能正確聲明屬權。
- **iOS 喚回邏輯修復**：強化 `MediaSession` 在 `visibilitychange` 發生時的宣告，確保系統能正確關聯到 `radio.sisihome.org` 並喚起正確的 App。
- **PWA 識別強化**：在 `manifest.webmanifest` 中加入唯一標識符，協助 iOS 區分同域名的不同應用。

## Capabilities

### New Capabilities
- `track-card-interaction`: 定義曲目卡片的全區域互動規範，包括點擊播放與內部按鈕的事件隔離。
- `ios-pwa-media-isolation`: 針對 iOS PWA 環境下的 MediaSession 唯一性宣告與喚回路徑修復規範。

### Modified Capabilities
- `media-session-management`: 修改現有的 MediaSession 更新邏輯，移除 embedded 模式的限制。

## Impact

- **Frontend**: `SearchResults.tsx`, `AudioPlayer.tsx`, `manifest.webmanifest`
- **UI/UX**: 提升搜尋結果的易用性，與主流音樂應用行為一致。
- **System**: 解決 iOS 下多個 PWA 域名衝突導致的導航錯誤。
