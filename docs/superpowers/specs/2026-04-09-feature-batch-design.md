# Home Media Feature Batch Design

## 1. 封鎖系統

**資料層：** SQLite `blocked_items` 表 — `id, type (song|channel), videoId, channelName, title, thumbnail, blockedAt`
**API：** `POST /api/block`, `DELETE /api/block/:id`, `GET /api/blocked`
**前端 state：** 啟動時載入 blocked list 到 Redux `blockSlice`

**封鎖入口：**
- 搜尋結果 / 播放清單每首歌的 ⋮ 選單：「封鎖這首歌」+「封鎖此頻道」
- 推薦區已有的刪除頻道機制併入封鎖系統

**行為：**
- 搜尋結果：顯示但灰色 + 🚫，點擊仍可播放
- 推薦 / 自動佇列：完全過濾
- 已在佇列中的不主動移除

**5 秒反悔：** Snackbar「已封鎖 {名稱}」+ 復原按鈕，5 秒後生效

**管理：** 設定頁 > 封鎖管理 — 歌曲/頻道分組列表 + 解除封鎖按鈕

---

## 2. Lazy Loading 優化

**首頁推薦區橫向滾動：**
- 每個頻道的橫向卡片列表改為 IntersectionObserver 監控最後一張卡片
- 進入可視區域時載入下一批（10 張）
- 顯示尾部 skeleton 佔位

**首頁垂直滾動：**
- 目前滑到底才載入 → 改為距底部 300px 時提前觸發
- 用 `rootMargin: '0px 0px 300px 0px'` 的 IntersectionObserver

**搜尋結果：**
- 同上，距底部 300px 提前觸發下一頁

---

## 3. 翻譯歌詞紀錄（成功廣播）

**後端：** 翻譯成功後，透過 Socket.io `lyrics:translation-ready` 事件廣播 `{ videoId, translations[] }`
**前端：** `useLyricsSync` hook 監聽 `lyrics:translation-ready`，收到後直接 `setTranslations()` 不再呼叫 Gemini
**觸發時機：** 翻譯 API 回傳成功（含快取命中），都 emit broadcast
**好處：** 一台翻譯成功 → 所有裝置即時收到，不重複消耗 Gemini quota

---

## 4. 優化歌詞翻譯

**問題：** B（時有時無）+ C（翻譯對不上行）

**修法：**
- 後端 retry 已修（用完所有 key）✅
- 前端 null result 已修（進入 retry）✅
- **追加：** indexed-object format 解析強化 — 行數不匹配時 log 警告但不丟棄
- **追加：** 翻譯 prompt 加強指令「每一行都必須翻譯，不得跳行」
- **追加：** 前端顯示翻譯行數不匹配提示（而非靜默空白）

---

## 5. 佇列 UI 優化

**現有：** 歌詞 Drawer 下方的播放清單只能看和點播
**新增：**
- 拖曳排序（react-beautiful-dnd 已在 dependencies）
- 左滑或長按顯示「移除」按鈕
- 「插隊播放」選項 — 插入到當前播放的下一首
- 正在播放的歌有醒目標示（高亮 + 播放動畫）
- 滾動到正在播放的位置

---

## 6. 無縫切歌 (Gapless)

**問題：** 切歌時有 0.5-1 秒靜音空白

**方案：** 利用現有的 quick-start 機制延伸 —
- 歌曲最後 0.3 秒開始淡出（volume 100%→0%，300ms）
- 同時將預建的 nextBlobUrl 設為 src 並 play
- 下一首淡入（volume 0%→100%，300ms）
- 不用 Web Audio API，純 HTMLAudioElement volume 控制
- 非 crossfade（不是兩首同時播），而是快速切換 + 短淡化掩蓋空白

---

## 7. ❤️ 收藏

**資料層：** SQLite `favorites` 表 — `id, videoId, title, channel, thumbnail, duration, favoritedAt`
**API：** `POST /api/favorites/:videoId`, `DELETE /api/favorites/:videoId`, `GET /api/favorites`
**前端：**
- 搜尋結果 / 播放清單 / mini player / 歌詞 Drawer 都顯示 ❤️ 按鈕
- 點擊 toggle — 紅色實心 = 已收藏，空心 = 未收藏
- Redux `favoritesSlice` 啟動時載入
**推薦影響：** 收藏的歌/頻道在推薦演算法中權重 ×3

---

## 8. 首頁個人化推薦牆

**現有：** 首頁按頻道分組推薦
**新增區塊（首頁最上方）：**
- 「為你推薦」— 基於 play_count + favorites + recent history 的混合推薦
- 「最近播放」— 最近 10 首的橫向捲動
- 「你可能喜歡」— Gemini AI 基於收藏/歷史推薦的新頻道
**API：** `GET /api/recommendations/personalized` — 綜合 cached_tracks + favorites 計算

---

## 9. 播放紀錄頁面

**入口：** 底部導航「播放清單」tab 內新增「最近播放」section，或設定頁連結
**內容：**
- 按日期分組（今天、昨天、本週、更早）
- 每首顯示：縮圖 + 標題 + 頻道 + 播放次數 + 最後播放時間
- 點擊直接播放
**資料來源：** `cached_tracks` 表已有 `play_count` + `last_played_at`（需確認 `last_played_at` 欄位是否存在，不存在就加）

---

## 10. 搜尋結果分類 Tab

**現有：** 搜尋結果是一個平面列表
**新增：** 搜尋結果頁加 tab 切換
- 「全部」— 現有行為
- 「歌曲」— 過濾 duration < 10 min
- 「頻道」— 依 channel 歸組，顯示頻道卡片 + 旗下歌曲
- 「播放清單」— 搜尋使用者自己的播放清單中匹配的歌
**實作：** 純前端過濾，不需要額外 API
