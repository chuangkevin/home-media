## Why

電台模式目前歌曲之間是硬切換，聽眾體驗像在切歌而非聽廣播。真正的電台/DJ 體驗需要歌曲間的 crossfade 過渡，讓聽眾感受到兩首歌交融的瞬間，營造「一直有音樂在播」的沉浸感。

## What Changes

- 新增雙 `<audio>` element 架構，支援歌曲尾段交叉淡入淡出（最後 ~5 秒）
- Host (DJ) 端：偵測接近歌曲結尾時，在第二個 audio element 預載下一首並執行音量漸變動畫
- Listener 端：收到 `radio:crossfade-start` socket 事件後，在本地執行相同的 crossfade 過渡
- Crossfade 僅在電台/DJ 模式啟用，一般播放不受影響
- 新增 RadioPanel 或設定中的 crossfade 開關，偏好存 localStorage
- 影片模式下停用 crossfade（僅音訊模式支援）
- MediaSession (鎖屏) 需在 crossfade 完成後指向新的 active element
- 行動裝置需提早 "warm up" 第二個 audio element 以繞過 autoplay 限制

## Capabilities

### New Capabilities
- `crossfade-engine`: 雙 audio element 管理、音量漸變動畫、元素角色交換
- `crossfade-radio-sync`: Host 發送 crossfade 開始事件、Listener 接收並執行本地 crossfade

### Modified Capabilities
_無修改現有 spec 層級行為_

## Impact

- **Frontend**: `AudioPlayer.tsx`（核心：雙 audio 架構）、`useRadioSync.ts`、`radioSlice.ts`
- **Backend**: `radio.handler.ts`（新 socket 事件）、`radio.service.ts`（crossfade 狀態）
- **Services**: `socket.service.ts`（新方法）
- **風險**: 鎖屏播放、SponsorBlock、行動裝置 autoplay 限制、記憶體（兩個 Blob URL 同時載入）
