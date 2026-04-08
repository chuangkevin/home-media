# Capability Spec: ios-pwa-media-isolation

## Context
在 iOS PWA 模式下，多個同域名的應用程式會發生 MediaSession 衝突。我們需要明確宣告 `radio.sisihome.org` 的屬權，避免點擊鎖定畫面時喚起錯誤的應用（如 `portal`）。

## Requirements
1.  **PWA ID 聲明 (PWA Identity Isolation)**：
    -   `manifest.webmanifest` 必須包含唯一的 `id` 欄位（例如：`/home-media`）。
    -   `scope` 必須限制為 `/`。
2.  **MediaSession 權限宣告 (Ownership Assertion)**：
    -   移除 `AudioPlayer.tsx` 中 `embedded` 模式對 `MediaSession` 更新的限制。
    -   當媒體載入 (`currentTrack` 更新) 或應用程式回到前景 (`visibilitychange`) 時，應主動宣告屬權。
3.  **喚回喚醒邏輯 (Resume Assertive Behavior)**：
    -   當 iOS 鎖定畫面點擊「回到 App」時，如果系統喚起了 `radio` PWA，`radio` 應在 `visibilitychange` 事件觸發時，透過更新 `MediaSession` 來宣告目前的播放狀態為 `playing`。
    -   這有助於系統在多個候選 PWA 中，識別目前真正持有音訊串流的 Origin。

## Success Criteria
- [ ] iOS 鎖定畫面顯示正確的媒體資訊與進度。
- [ ] 點擊鎖定畫面媒體資訊，能正確導向 `radio.sisihome.org` (Home Media) 而非 `portal.sisihome.org`。
