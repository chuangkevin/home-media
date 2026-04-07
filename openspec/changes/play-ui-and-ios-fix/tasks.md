## 1. 播放介面全區域點擊優化

- [ ] 1.1 修改 `frontend/src/components/Search/SearchResults.tsx`，將 `Card` 內部改用 `CardActionArea` 包裝，並將點擊事件綁定至 `onPlay(track)`。
- [ ] 1.2 在 `SearchResults.tsx` 的子按鈕（「加入佇列」、「加入播放清單」）中加入 `e.stopPropagation()` 以隔離點擊事件。
- [ ] 1.3 檢查 `Home` 相關推薦組件（如果有）是否也需要類似的全區域點擊優化。

## 2. iOS PWA 唯一性標識強化

- [ ] 2.1 在 `frontend/public/manifest.webmanifest` 中加入 `"id": "/home-media"` 與 `"scope": "/"`。
- [ ] 2.2 確認 `manifest.webmanifest` 的 `short_name` 與 `name` 是否足以區分其他 PWA。

## 3. MediaSession 隔離與喚回修復

- [ ] 3.1 在 `frontend/src/components/Player/AudioPlayer.tsx` 中搜尋並移除 `if (embedded || !('mediaSession' in navigator))` 中針對 `embedded` 的 return 限制，讓嵌入模式也能更新 `MediaSession`。
- [ ] 3.2 在 `AudioPlayer.tsx` 的 `handleVisibilityChange` 中，加入對 `MediaSession` 的主動宣告邏輯：當應用程式回到前景時，強制重新設置一次 `navigator.mediaSession.metadata` 與 `playbackState`。

## 4. 驗證與交付

- [ ] 4.1 進行版本遞增 (Version Bump)：更新 `package.json` 中的版本號 (例如從 `v1.2.x` 升級為 `v1.3.0` 或 patch 升級)。
- [ ] 4.2 更新 `.claude-memory/` 中的技術決策紀錄。
- [ ] 4.3 執行 `git add`, `git commit` 並 `git push`（不問使用者，主動執行）。
