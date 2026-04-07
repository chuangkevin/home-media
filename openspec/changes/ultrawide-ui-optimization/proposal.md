## Why

用戶在 1920*720 的平板設備上使用時，目前的響應式設計未針對「極寬且矮」的螢幕進行優化。這導致：
1. 歌詞文字過小，難以閱讀。
2. 垂直空間被 Header/Footer 佔據過多，中間歌詞顯示區域侷促。
3. 瀏覽器網址列進一步壓縮可用高度，使操作按鈕變得極小且難以精準觸控。

## What Changes

- **Ultrawide 偵測**：引入針對寬螢幕、低高度設備的偵測邏輯。
- **佈局緊湊化**：大幅縮減全螢幕模式下的 Header、Footer 及 ToggleButtonGroup 的垂直邊距。
- **字體巨量化**：將歌詞與翻譯的字體大小大幅提升（約 30-50%）。
- **觸控優化**：加大 IconButton 與 ToggleButton 的尺寸，並增加間距以符合平板觸控需求。

## Capabilities

### New Capabilities
- `ultrawide-responsive-layout`: 針對 1920*720 等極長寬比螢幕的佈局優化規範。

### Modified Capabilities
- `lyrics-display-ui`: 修改現有歌詞顯示組件的字體與間距參數。

## Impact

- **Frontend**: `FullscreenLyrics.tsx`, `PlayerControls.tsx`, `AudioPlayer.tsx`
- **UX**: 顯著提升平板與車載螢幕的使用友善度。
