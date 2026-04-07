## 1. 斷點與環境定義

- [ ] 1.1 在 `FullscreenLyrics.tsx` 中新增 `isUltrawide` 變數偵測 `(min-width: 1200px) and (max-height: 800px)`。
- [ ] 1.2 確保該偵測邏輯也能被 `PlayerControls.tsx` 使用。

## 2. 歌詞顯示優化

- [ ] 2.1 修改 `renderLyrics` 的字體大小，當 `isUltrawide` 為真時：
    - Active: `3.8rem`
    - Normal: `2.4rem`
    - Translation: `1.8rem`
- [ ] 2.2 縮減歌詞行的垂直內邊距 (`py`)，從 2 改為 1 或 0.5。
- [ ] 2.3 調整歌詞容器頂部與底部的填充高度 (`vh`)，適配矮螢幕。

## 3. UI 控制項與邊距優化

- [ ] 3.1 縮減 `FullscreenLyrics` 頂部 Header 的 `py`。
- [ ] 3.2 加大 `ToggleButtonGroup` 中的按鈕尺寸與字體。
- [ ] 3.3 在 `PlayerControls.tsx` 中，當 `isUltrawide` 時加大播放與切換按鈕的尺寸 (`size="large"`)。

## 4. 驗證與交付

- [ ] 4.1 進行版本遞增 (Version Bump)。
- [ ] 4.2 更新 `.claude-memory/` 技術決策。
- [ ] 4.3 執行 `git commit` 並 `git push`。
