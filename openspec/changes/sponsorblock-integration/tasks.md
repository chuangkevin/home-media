## 1. Backend - SponsorBlock Service

- [ ] 1.1 建立 `sponsorblock.service.ts` — 查詢 SponsorBlock API + SQLite 快取
- [ ] 1.2 API endpoint: `GET /api/sponsorblock/:videoId` — 回傳 skip segments
- [ ] 1.3 SQLite 表: `sponsorblock_cache` (video_id, segments_json, cached_at)
- [ ] 1.4 快取 TTL: 7 天（segments 不常變）

## 2. Frontend - 自動跳過

- [ ] 2.1 播放開始時查詢 segments
- [ ] 2.2 `timeupdate` 中檢查 currentTime 是否在 skip range 內
- [ ] 2.3 自動 `audio.currentTime = segment.end`
- [ ] 2.4 顯示跳過提示 (Snackbar: "已跳過工商 15s")

## 3. 設定頁面

- [ ] 3.1 AdminSettings 新增 SponsorBlock 區塊
- [ ] 3.2 可選類別 toggle: music_offtopic / sponsor / intro / outro
- [ ] 3.3 儲存到 settings 表

## 4. 測試 & 提交

- [ ] 4.1 測試有 segments 的影片
- [ ] 4.2 測試無 segments 的影片
- [ ] 4.3 Commit, push
