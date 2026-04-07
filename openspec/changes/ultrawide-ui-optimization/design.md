## Context

目前專案使用 MUI 的 `useMediaQuery` 進行響應式設計。對於 1920*720 的平板，`isLandscape` 與 `isShortViewport` 會同時觸發，但目前的參數（如字體 `2.8rem`）在該寬度下依然太小。此外，MUI 預設的 `IconButton` 在 720p 螢幕（考慮到網址列後剩餘約 600px）上，其垂直空間佔比過高，且觸控區域不足。

## Goals / Non-Goals

**Goals:**
- 在 1920*720 下實現「沉浸式大字體」歌詞體驗。
- 壓縮 UI 邊距，為歌詞留出更多垂直空間。
- 加大按鈕，提升平板觸控精準度。

**Non-Goals:**
- 修改桌面版（1080p 以上）或手機版的現有佈局。
- 移除瀏覽器網址列（PWA 模式下已自動隱藏，但需相容非 PWA 模式）。

## Decisions

### 1. 定義 Ultrawide 偵測邏輯
- **邏輯**：`const isUltrawide = useMediaQuery('(min-width: 1200px) and (max-height: 800px)');`
- **理由**：區分普通的橫向手機（寬度小）與專業平板/車載螢幕（寬度極大但高度受限）。

### 2. 歌詞佈局優化
- **字體提升**：
    - `Active`: `2.8rem` -> `3.8rem`
    - `Normal`: `1.8rem` -> `2.4rem`
    - `Translation`: `1.4rem` -> `1.8rem`
- **邊距壓縮**：將 `ListItem` 的 `py: 2` 改為 `py: 1` 或更小，以補償矮螢幕的空間。

### 3. 控制項優化 (PlayerControls)
- **按鈕尺寸**：在 Ultrawide 模式下，主控制按鈕（Play/Next）強制使用 `size="large"` 並增加 `padding`。
- **佈局**：在全螢幕歌詞中，若寬度足夠，可考慮將「模式切換」與「曲目資訊」並排，而非垂直排列。

## Risks / Trade-offs

- [Risk]：大字體可能導致歌詞折行嚴重。
  - Mitigation：在橫向模式下，左右 Padding 會自動增加，並限制 `maxWidth`。
- [Risk]：壓縮邊距可能導致 UI 看起來過於擁擠。
  - Mitigation：僅針對垂直方向壓縮，水平方向保持寬敞。
