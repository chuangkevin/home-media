## 1. 播放介面全區域點擊優化

- [x] 1.1 修改 `frontend/src/components/Search/SearchResults.tsx`，將 `Card` 內部改用 `CardActionArea` 包裝，並將點擊事件綁定至 `onPlay(track)`。
- [x] 1.2 在 `SearchResults.tsx` 的子按鈕（「加入佇列」、「加入播放清單」）中加入 `e.stopPropagation()` 以隔離點擊事件。
- [x] 1.3 檢查 `Home` 相關推薦組件（如果有）是否也需要類似的全區域點擊優化。

## 2. iOS PWA 唯一性標識強化

- [x] 2.1 在 `frontend/public/manifest.webmanifest` 中加入 `"id": "/home-media"` 與 `"scope": "/"`。
- [x] 2.2 確認 `manifest.webmanifest` 的 `short_name` 與 `name` 是否足以區分其他 PWA。
- [x] 2.3 修正 `sw.js` 中的預快取路徑（`/manifest.json` -> `/manifest.webmanifest`）。

## 3. MediaSession 隔離與喚回修復

- [x] 3.1 在 `frontend/src/components/Player/AudioPlayer.tsx` 中搜尋並移除 `if (embedded || !('mediaSession' in navigator))` 中針對 `embedded` 的 return 限制，讓嵌入模式也能更新 `MediaSession`。
- [x] 3.2 在 `AudioPlayer.tsx` 的 `handleVisibilityAssert` 中，加入對 `MediaSession` 的主動宣告邏輯：當應用程式回到前景時，強制重新設置一次 `navigator.mediaSession.metadata` 與 `playbackState`。

## 4. 影片同步與效能優化 (追加任務)

- [x] 4.1 修改 `FullscreenLyrics.tsx`，移除影片 Tab 的 `disabled={!videoCached}` 限制，並實作 IFrame fallback。
- [x] 4.2 在 `FullscreenLyrics.tsx` 與 `VideoPlayer.tsx` 中放寬同步容差至 2-3s，降低同步頻率至 1s。
- [x] 4.3 實作「恢復鎖 (Recovery Lock)」：偵測 `visibilitychange` 回到前景後暫停同步 2.5s。
- [x] 4.4 修正 `App.tsx` 避免同時渲染兩個影片組件。

## 5. 驗證與交付

- [x] 5.1 進行版本遞增 (Version Bump)：更新至 `v1.3.1`。
- [x] 5.2 更新 `.claude-memory/` 中的技術決策紀錄。
- [x] 5.3 執行 `git add`, `git commit` 並 `git push`（不問使用者，主動執行）。
