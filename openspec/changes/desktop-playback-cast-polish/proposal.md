## Why

目前 `home-media` 在桌面與影片歌詞模式還有一批 UX / playback 問題：
1. 高解析度桌面螢幕下，右側播放清單偏窄、首頁仍依賴橫向滑動，滑鼠操作不友善。
2. 左側嵌入播放器缺少收藏按鈕。
3. 影片模式下拖動進度條未穩定反映到實際音訊與影片同步位置。
4. 歌詞來源若 LRCLIB 沒有 synced 結果，應更積極回退到 NetEase。
5. 影片模式有歌詞重複顯示問題。
6. 沉浸模式預設效果與偏好記憶不符合預期。
7. 投射目前仍把接收端當作受控播放器，與「射後不理」的需求不符。

## What Changes

- 優化桌面三欄寬度與首頁桌面互動，移除桌面必須水平捲動的瀏覽方式。
- 補齊嵌入播放器收藏操作。
- 修正影片模式 seek 與歌詞 overlay 重複問題。
- 將 LRCLIB 無 synced 歌詞時的 fallback 明確導向 NetEase。
- 沉浸模式預設改為「模糊聚焦」，並持久化使用者選擇。
- 投射改成 start-only session：啟動後接收端獨立播放，不再跟著發射端後續控制與狀態變化。

## Impact

- Frontend: `App.tsx`, `AudioPlayer.tsx`, `FullscreenLyrics.tsx`, `MorrorLyrics.tsx`, `PlayerControls.tsx`, `HomeRecommendations.tsx`, `PersonalizedSection.tsx`, `ChannelSection.tsx`, cast components/hooks
- Backend: cast handler / personalized recommendations limits if needed
- Spec: desktop ergonomics, lyrics fallback, cast behavior
