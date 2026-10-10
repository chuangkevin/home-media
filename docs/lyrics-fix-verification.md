# 歌詞切換、永久快取與字體調整驗證

## 重現與根因
線上 b4a5eac 已實際觀察到播放曲目 `dvgZkm1xWPE`，Redux 歌詞卻仍屬於 `YykjpeuMNEk`。歌詞載入依附 pending 音訊流程，crossfade／continuous 的直接確認可能跳過；Redux 沒有 ownership，非同步偏好、翻譯與來源更新也可晚到污染新歌。

## 修正
- confirmed currentTrack 是共用歌詞唯一載入 owner；pending 保留正在播放的歌詞，確認切歌原子切換歌詞 ownership、高亮與偏移。
- 舊請求、retry、快取寫入完成、Socket 更新以歌曲／歌詞物件／generation 驗證。翻譯廣播帶來源行與目標語言，不能只依歌曲 ID 誤套不同版本。
- SSE／radio 不再另開競爭的通用歌詞載入覆寫已選來源；保留媒體 owner 與播放流程。
- IndexedDB 歌詞移除 30 天 TTL 與 500 筆自動淘汰；後端日期清理成為 no-op。
- SQLite 永久翻譯複合鍵：歌曲 ID＋來源文字與 prompt 版本 SHA-256＋目標語言。相符舊版本可遷移，明確 force 才重新翻譯；失敗保留既有版本。
- 「字體」入口提供原文與中文翻譯分開調整 75–250%，預設／大字／特大／最大；localStorage 永久偏好。一般歌詞、影片字幕與沉浸模式套用相同偏好，放大後重新對準目前歌詞。

## 已執行
- 前後端 build 通過；前端完整 126 tests 通過。
- 後端歌詞、翻譯、AI 快取及標題解析 4 檔案共 30 tests 通過。
- RED／GREEN 覆蓋 confirmed direct／next／crossfade／continuous、pending 保留、舊偏好、舊翻譯與 timer、Socket cache await、legacy reload 的舊操作偏移污染，以及同曲不同版本翻譯廣播。
- ego-lite 實際播放 Yellow → Hymn For The Weekend → Viva La Vida → The Scientist；歌詞 DOM 與 Redux 歌曲相符，所有記錄零 ownership mismatch，雙 audio 節點維持不變。
- ego-lite 字級原文 32→48 px、翻譯 18→36 px；最大 250% 與 reload 後保留也實測。手機 852×300 放大後未出現水平溢位，設定面板內容可捲動。
- QA 腳本 `frontend/tests/ego/lyrics-switch-qa.js` 使用實際頁面／實際歌曲，合成資料只存在隔離單元測試。

## 限制與非本次範圍
- 完整後端 Vitest source suite 出現 3 項推薦子行程測試失敗；未改動的基準 b4a5eac 在相同主機獨立重跑也有 2 項同類失敗（子行程數與期限斷言）。未以此宣稱後端全部測試通過，未混入推薦模組修正。
- 建置保留既有大型 bundle 警告。
- 本次永久快取指歌詞與翻譯；音訊／影片檔容量管理與既有檔案淘汰政策沒有變更。
- ego-lite 為 Chromium 實測，未宣稱 iPhone Safari 背景／鎖屏真機驗證。
