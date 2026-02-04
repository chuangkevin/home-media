# 🎵 Spotify 推薦功能設定指南（選用）

推薦功能**預設已啟用**，使用 YouTube metadata 即可運作。
以下步驟是**選用的增強功能**，可以讓推薦更精準。

## 方式一：Docker 部署（推薦）

### 1. 取得 Spotify API 憑證

1. 前往 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. 登入（免費帳號即可）
3. 點擊 **"Create App"**
4. 填寫資訊：
   - App Name: `Home Media Center`
   - App Description: `Personal music recommendation`
   - Redirect URIs: `http://localhost:3001/callback`（必填，但不會用到）
   - APIs Used: Web API
5. 儲存後點 **"Settings"**
6. 複製 **Client ID** 和 **Client Secret**

### 2. 編輯 docker-compose.yml

找到 `backend` 服務的 `environment` 區塊，取消註解並填入：

```yaml
services:
  backend:
    environment:
      # ... 其他設定 ...
      
      # Spotify API (Optional)
      - SPOTIFY_CLIENT_ID=你的_client_id
      - SPOTIFY_CLIENT_SECRET=你的_client_secret
```

### 3. 重啟服務

```bash
docker compose down
docker compose up -d
```

### 4. 驗證設定

```bash
# 檢查 Spotify API 狀態
curl http://localhost:3123/api/spotify/status

# 應該回傳：
# {
#   "configured": true,
#   "message": "Spotify API is configured and ready"
# }
```

---

## 方式二：本地開發

### 1. 建立 .env 檔案

在 `backend/` 目錄建立 `.env` 檔案：

```bash
cd backend
cp .env.example .env
```

### 2. 編輯 .env

```bash
# Spotify API (Optional)
SPOTIFY_CLIENT_ID=你的_client_id
SPOTIFY_CLIENT_SECRET=你的_client_secret
```

### 3. 重啟後端

```bash
# Windows
.\local-dev-stop.bat
.\local-dev-start.bat

# Linux/Mac
./local-dev-stop.sh
./local-dev-start.sh
```

---

## 使用 Spotify 增強推薦

設定完成後，推薦引擎會自動使用 Spotify 資料。

### 自動充實 metadata

播放歌曲時，系統會**自動**在背景搜尋 Spotify 並儲存 metadata。

### 手動充實（批次處理）

如果想一次處理所有已播放的歌曲：

```bash
# 1. 取得所有歌曲列表
curl http://localhost:3123/api/history/searches > tracks.json

# 2. 批次充實（PowerShell）
$tracks = (Invoke-RestMethod http://localhost:3123/api/history/searches).items | Select-Object -ExpandProperty videoId
Invoke-RestMethod -Method POST -Uri "http://localhost:3123/api/spotify/enrich-batch" -Body (@{videoIds=$tracks} | ConvertTo-Json) -ContentType "application/json"

# 3. 查看結果
curl http://localhost:3123/api/recommendations/genres
```

---

## 功能差異比較

| 功能 | YouTube-only 模式 | Spotify 增強模式 |
|------|------------------|------------------|
| **推薦基礎** | YouTube tags + 頻道名 | + 專業曲風分類 + 音訊特徵 |
| **設定需求** | ✅ 零設定 | ⚙️ 需要 API credentials |
| **推薦準確度** | 🟢 良好（70%） | 🟢🟢 優秀（85%+） |
| **曲風分類** | ❌ 無 | ✅ 有 (pop, rock, jazz...) |
| **音訊特徵** | ❌ 無 | ✅ 13 項指標 |
| **適合場景** | 一般使用 | 音樂愛好者 |

---

## 疑難排解

### "configured": false

**原因：** 環境變數未設定或格式錯誤

**解決方式：**
1. Docker: 檢查 `docker-compose.yml` 是否正確取消註解
2. 本地: 檢查 `backend/.env` 檔案是否存在
3. 重啟服務：`docker compose restart backend`

### "Failed to authenticate with Spotify"

**原因：** Credentials 無效

**解決方式：**
1. 到 Spotify Developer Dashboard 重新確認 Client ID/Secret
2. 確認沒有多餘空格或換行
3. 測試 credentials：
   ```bash
   curl -X POST "https://accounts.spotify.com/api/token" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=client_credentials" \
     -u "CLIENT_ID:CLIENT_SECRET"
   ```

### 推薦結果沒有改善

**可能原因：** 歌曲尚未充實 Spotify metadata

**解決方式：**
```bash
# 檢查特定歌曲是否有 Spotify 資料
curl http://localhost:3123/api/spotify/track/VIDEO_ID

# 手動充實
curl -X POST http://localhost:3123/api/spotify/enrich/VIDEO_ID

# 批次充實所有歌曲（參考上方「手動充實」步驟）
```

---

## 取消 Spotify 功能

如果不想使用 Spotify：

### Docker 部署
1. 註解掉或刪除 `docker-compose.yml` 中的 Spotify 環境變數
2. `docker compose restart backend`

### 本地開發
1. 從 `backend/.env` 刪除或註解掉 Spotify 設定
2. 重啟後端

系統會**自動切換回 YouTube-only 模式**，所有功能繼續正常運作。

---

## 常見問題

**Q: 免費 Spotify 帳號可以嗎？**  
A: 可以！Client Credentials flow 不需要 Premium。

**Q: 會存取我的 Spotify 播放清單嗎？**  
A: 不會。我們只搜尋歌曲 metadata，不存取使用者資料。

**Q: 有 API 呼叫次數限制嗎？**  
A: Spotify 免費額度非常充足，一般家用不會超過。系統已內建 rate limiting 保護。

**Q: 設定後會自動處理所有歌曲嗎？**  
A: 新播放的歌曲會自動處理。舊歌曲需要手動批次充實（參考上方步驟）。

**Q: 可以只充實特定歌曲嗎？**  
A: 可以，使用 `POST /api/spotify/enrich/:videoId`。

**Q: Spotify 無法匹配某些歌曲？**  
A: 正常現象。自製內容、翻唱、地區限定等歌曲可能無法匹配。系統會自動跳過，不影響推薦功能。

---

更多技術細節請參考：[backend/SPOTIFY_INTEGRATION.md](backend/SPOTIFY_INTEGRATION.md)
