# 歌曲與歌詞來源匹配驗證

本次處理歌詞內容是否屬於所播放歌曲，以及時間軸合理性；不是把相同 videoId 當作匹配證明。

## 實際證據
- 官方影片 metadata：PFDO5OZO61Y，ROSÉ - drinks or coffee (official audio)，channel ROSÉ，duration 133 秒。
- FFmpeg 實讀網站 `/api/stream/PFDO5OZO61Y`：AAC，duration 133.18966 秒；不是只讀資料庫欄位。
- 公開 LRCLIB 回傳 20 個候選，第一筆有同步歌詞但 duration 80 秒，不能直接採用。另有 2、29、121、170 秒等候選。
- 新 matcher 以 133 秒輸入實際選到 15525219：drinks or coffee／Rosé／133 秒；41 行，最後時間 129.54 秒。與 Genius 搜尋結果及使用者照片中的詞句相符。
- 該來源「Gotta keep it nice, we cannot be naughty」的三個時間戳為 38.08、94.63、108.63 秒。
- ego-lite 使用實際官方音訊與本機新 API，透過真實播放進度控制跳至 39、95、109 秒；從 audio.currentTime 與畫面高亮同時確認各自對到上述歌詞，不只比對 ID。
- AI API 既有結果最後時間 209.923 秒，超出實際 133.18966 秒音訊；不能作為可信時間軸。新增 regression 先重現 cached result 被直接回傳，再拒絕不可能的結果，永久原始資料不刪除。

## 修正
- LRCLIB／NetEase 自動候選先檢查完整歌名、藝人、版本（live/remix/cover/acoustic 等）、曲長，拒絕不吻合者；同步格式只是排序依據，不是歌曲證據。
- 保留來源 provenance，區分 metadata／publisher-caption 與明確 user-selection；來源缺乏證據時不加上 verified 標示。
- 前端帶歌曲 duration 到新 API；舊 IndexedDB 不再因 videoId 或 isSynced 相同而直接回傳，也不走直接來源 ID 的自動旁路。
- 經後端匹配的確切請求可永久重用；metadata 改變才重新確認，沒有 TTL、沒有刪除永久歷史紀錄。
- 移除 SponsorBlock intro 推測造成的整份時間位移與位移後再快取；來源時間不變，使用者明確設定的時間偏移仍保留。
- 前後端拒絕超出音訊長度、非有限、負數或倒序的歌詞時間。AI 生成時讀實際音訊檔案長度、提供給模型並在儲存前檢查；不能以 AI 回覆當作已驗證。
- ROSÉ 與 ROSÉ Unicode 正規化等價，但不自行視另一位 Rose 同藝人；中英雙語名稱只容許完整漢字、完整其他名稱均相符的空白差異。

## 已執行檢查
- 前後端 build 通過。
- 前端完整 131 tests 通過。
- 後端相關 6 檔案、45 tests 通過。
- RED/GREEN 包含同名錯藝人、不同歌曲排第一、版本混淆、不合曲長、未知舊快取、時間超出真正音訊、intro 位移污染，以及中英完整名稱空白差異。
- 之前已記錄的範圍外後端推薦子行程環境測試失敗未混入本次修正。

## 邊界
公開歌詞 metadata 與多來源內容核對不是逐字聽辨認證；我沒有以自己的聽覺逐字校對整首音訊。39／95／109 秒驗證的是實際音訊播放時鐘與外部來源時間戳的畫面對照。不確定的自動來源寧可回傳沒有匹配結果，也不任意套另一首歌。手動選擇來源仍是使用者選擇，不冒充自動驗證。
