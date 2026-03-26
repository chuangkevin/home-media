## Why

YouTube 音樂影片常包含非音樂段落（對話、劇情、工商）影響聽歌體驗。SponsorBlock 有免費公開 API 提供群眾標註的 skip segments，無需 AI、無需 API key、即可自動跳過。

## What Changes

- 後端：新增 SponsorBlock API 查詢 + SQLite 快取（避免重複查詢）
- 前端：播放時自動跳過 segments，設定頁面可選類別
- 支援類別：music_offtopic（非音樂）、sponsor（工商）、intro、outro、selfpromo、interaction

## Capabilities

### New Capabilities
- `sponsorblock-skip`: 自動查詢並跳過 SponsorBlock segments
- `skip-settings`: 用戶可選擇要跳過的類別

### Modified Capabilities

## Impact

- **Backend**: 新增 sponsorblock.service.ts、新增 API route、SQLite 新表
- **Frontend**: AudioPlayer.tsx 加入 skip 邏輯、AdminSettings 加入設定
- **Dependencies**: 無新依賴（直接 HTTP fetch SponsorBlock API）
- **No layout changes**
