# 混合推薦功能說明

## 功能概述

實作了智慧混合推薦系統，將基於相似度的智慧推薦與頻道推薦混合展示在首頁，提供更個人化的音樂發現體驗。

## 主要特點

### 1. 混合推薦模式

- **頻道推薦**：基於觀看歷史的頻道推薦（原有功能）
- **智慧推薦**：基於播放歷史的相似歌曲推薦（新功能）
- **自動混合**：系統自動將智慧推薦插入頻道推薦中

### 2. 相似度推薦演算法

推薦引擎會根據最近播放的歌曲，使用以下方式計算相似度：

#### YouTube-only 模式（預設）
- **50%** 標籤相似度（tags）
- **30%** 相同頻道權重（channel）
- **20%** 標題文字相似度（title）

#### Spotify 增強模式（可選）
- **40%** 曲風匹配度（genres）
- **30%** 音訊特徵相似度（audio features）
- **20%** 標籤相似度（tags）
- **10%** 頻道權重（channel）

### 3. 視覺識別

**智慧推薦區塊**擁有獨特的視覺設計：
- 🌟 漸變色標題（紫色漸變）
- ✨ 星星圖標替代頻道頭像
- 🏷️ "智慧推薦" 標籤
- 📊 顯示為 "根據您的收聽記錄"

**頻道推薦區塊**保持原有樣式：
- 頻道頭像
- 頻道名稱
- 觀看次數標籤

## API 端點

### 1. 混合推薦 API
```
GET /api/recommendations/mixed?page=0&pageSize=5&includeCount=3
```

**參數：**
- `page`: 頁碼（預設 0）
- `pageSize`: 每頁頻道數（預設 5）
- `includeCount`: 每首歌曲的相似推薦數量（預設 3）

**回應：**
```json
{
  "page": 0,
  "pageSize": 5,
  "count": 6,
  "hasMore": true,
  "recommendations": [
    {
      "type": "channel",
      "channelName": "Taylor Swift",
      "channelThumbnail": "...",
      "videos": [...],
      "watchCount": 15
    },
    {
      "type": "similar",
      "channelName": "根據您的收聽記錄",
      "videos": [...],
      "watchCount": 0
    }
  ]
}
```

### 2. 最近播放 API
```
GET /api/recommendations/recently-played?limit=10
```

**回應：**
```json
{
  "count": 5,
  "tracks": [
    {
      "videoId": "abc123",
      "title": "Song Name",
      "channelName": "Artist",
      "thumbnail": "...",
      "duration": 180,
      "lastPlayed": 1704067200000,
      "playCount": 3
    }
  ]
}
```

### 3. 相似歌曲推薦 API
```
GET /api/recommendations/similar/:videoId?limit=10
```

**回應：**
```json
{
  "seed": {
    "videoId": "abc123",
    "title": "Seed Song"
  },
  "recommendations": [
    {
      "videoId": "xyz789",
      "title": "Similar Song",
      "channelName": "Artist",
      "thumbnail": "...",
      "score": 0.85,
      "reasons": ["相似標籤: pop, rock", "相同頻道"]
    }
  ]
}
```

## 前端實作

### Redux State 更新

```typescript
interface RecommendationState {
  channelRecommendations: ChannelRecommendation[];
  useMixedMode: boolean; // 新增：混合模式開關
  // ...
}

interface ChannelRecommendation {
  type?: 'channel' | 'similar'; // 新增：區分推薦類型
  channelName: string;
  videos: Track[];
  // ...
}
```

### API Service 新增方法

```typescript
// 混合推薦
getMixedRecommendations(page, pageSize, includeCount)

// 最近播放
getRecentlyPlayed(limit)

// 相似歌曲
getSimilarTracks(videoId, limit)
```

## 使用流程

1. **首次訪問**：顯示基於觀看歷史的頻道推薦（原有功能）
2. **播放音樂**：系統記錄 `last_played` 和 `play_count` 到 `cached_tracks` 表
3. **生成智慧推薦**：
   - 系統獲取最近播放的 5 首歌曲
   - 為每首歌調用相似度推薦 API
   - 合併並去重推薦結果
4. **混合展示**：
   - 在前 2-3 個頻道推薦後插入智慧推薦區塊
   - 智慧推薦區塊包含 10 首高相似度歌曲
   - 保持流暢的滾動瀏覽體驗

## 技術優勢

### 1. 零配置運行
- 無需 Spotify API 即可運行（YouTube-only 模式）
- 自動適應可用數據（adaptive scoring）
- 容器化部署即開即用

### 2. 漸進增強
- 基礎功能：頻道推薦（原有）
- 第一層增強：基於 YouTube 元數據的相似推薦
- 第二層增強：Spotify 音訊特徵分析（可選）

### 3. 性能優化
- 後端緩存推薦結果
- 前端 Redux 狀態管理
- 懶加載與無限滾動

### 4. 用戶體驗
- 視覺區分不同推薦類型
- 平滑的內容混合
- 實時快取狀態顯示

## 未來擴展

- [ ] 添加推薦理由提示（顯示相似度原因）
- [ ] 支援手動切換混合模式開關
- [ ] 推薦結果個人化調整（喜歡/不喜歡）
- [ ] 探索模式（完全基於新發現）
- [ ] 推薦分析統計（推薦準確度追蹤）

## 資料庫依賴

### cached_tracks 表欄位
- `video_id`: 影片 ID
- `title`: 歌曲標題
- `channel_name`: 頻道名稱
- `last_played`: 最後播放時間（用於獲取最近播放）
- `play_count`: 播放次數
- `tags`: YouTube 標籤（JSON array）
- `genres`: Spotify 曲風（JSON array，可選）
- `audio_features`: 音訊特徵（JSON object，可選）

## 開發者注意事項

1. **API 超時處理**：相似推薦 API 設有 2 秒超時，避免阻塞主推薦流程
2. **去重邏輯**：使用 Map 確保相同 videoId 的歌曲不重複出現
3. **錯誤容忍**：單個相似推薦失敗不影響整體推薦展示
4. **空狀態處理**：無播放歷史時不顯示智慧推薦區塊
5. **類型安全**：完整的 TypeScript 類型定義

---

**最後更新：** 2024-01-XX  
**版本：** 1.0.0  
**狀態：** ✅ 已實作並測試
