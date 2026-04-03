## Design

### 歌詞下拉關閉手勢

**方案**: 在 Drawer 頂部操作列（drag handle + 曲目資訊）加 touch event handlers，不使用 SwipeableDrawer（會與內部可滾動歌詞衝突）。

- `touchAction: 'none'` 在 header 區域防止瀏覽器滾動攔截
- `touchStartYRef` 記錄起始 Y 座標
- `dragOffset` state 驅動 `transform: translateY()` 視覺回饋
- `isDraggingRef` 控制 CSS transition（拖動中關閉 transition 避免延遲）
- 閾值 80px → `onClose()`，未達閾值 → snap-back（`transition: transform 0.3s ease`）
- `useEffect` 在 drawer open/close 時重置所有拖動狀態

### Sticky 搜尋框

- `position: sticky, top: 0, zIndex: 5` 在滾動容器內
- `backgroundColor: background.paper` 確保不透明
- `mx: -3, px: 3` 將背景延伸到 Container 邊緣

### Tab Scroll-to-Top

- `scrollContainerRef` (useRef) 綁定到 `<Box flex:1 overflow:auto>` 滾動容器
- `scrollToTop` (useCallback) 傳入 BottomNav 作為 prop
- `getNavValue() === path` 判斷是否為同一 Tab → 呼叫 scrollToTop 而非 navigate
