# 🎵 家用多媒體中心

一個功能完整的 YouTube 音樂播放中心，支援線上串流、歌詞同步、音訊視覺化、曲風主題切換。

## ✨ 核心特色

- ✅ **純爬蟲技術** - 使用 ytdl-core 和 youtube-sr，無需 YouTube API Key
- ✅ **無廣告音訊** - 直接提取純音訊串流，過濾所有廣告
- ✅ **線上串流優先** - 即時播放，背景自動快取
- ✅ **智慧快取** - Session cache，最多保留 50 首，自動 LRU 淘汰
- ✅ **歌詞同步滾動** - 支援 YouTube CC、Genius、Musixmatch
- ✅ **音訊視覺化** - 即時頻譜分析與動態視覺效果
- ✅ **曲風主題** - 根據音樂類型自動切換 UI 主題
- ✅ **播放清單管理** - 建立、編輯、匯入/匯出播放清單
- ✅ **跨平台遠端控制** - 手機、平板控制播放

## 🏗️ 技術架構

### 後端
- **Node.js** + **Express** + **TypeScript**
- **ytdl-core** - YouTube 音訊爬蟲
- **youtube-sr** - YouTube 搜尋爬蟲
- **SQLite** - 播放清單與快取管理
- **Socket.io** - WebSocket 即時通訊

### 前端
- **React 18** + **Vite** + **TypeScript**
- **Redux Toolkit** - 狀態管理
- **Web Audio API** - 音訊分析與視覺化
- **Framer Motion** - 動畫效果
- **Material-UI** - UI 元件庫

### 部署
- **Docker** + **docker-compose**
- **Nginx** - 反向代理

## 🚀 快速開始

### 使用 Docker (推薦)

```bash
# Clone 專案
git clone <repo-url>
cd home-media

# 啟動容器
docker-compose up -d

# 存取應用
# 前端: http://localhost
# 後端 API: http://localhost:3001
```

### 本地開發

#### Windows 用戶 (推薦)

直接雙擊執行批次檔案：

```bash
# 啟動前後端服務
local-dev-start.bat

# 停止所有服務
local-dev-stop.bat

# 重啟服務
local-dev-restart.bat
```

服務啟動後：
- **前端**: http://localhost:5173
- **後端 API**: http://localhost:3001

#### 手動啟動

```bash
# 安裝後端依賴
cd backend
npm install
npm run dev

# 安裝前端依賴
cd ../frontend
npm install
npm run dev
```

## 📁 專案結構

```
home-media/
├── backend/              # Node.js 後端
│   ├── src/
│   │   ├── services/     # YouTube、歌詞、快取服務
│   │   ├── controllers/  # API 控制器
│   │   ├── models/       # 資料模型
│   │   └── routes/       # 路由
│   └── Dockerfile
│
├── frontend/             # React 前端
│   ├── src/
│   │   ├── components/   # UI 元件
│   │   ├── hooks/        # React Hooks
│   │   ├── store/        # Redux Store
│   │   └── styles/       # 主題與樣式
│   └── Dockerfile
│
├── docker-compose.yml    # Docker 編排
└── data/                 # 持久化資料 (快取、資料庫)
```

## 🎯 開發路線圖

- [x] 階段 1: 基礎設施
- [x] 階段 2: YouTube 整合 (搜尋、播放、中文標題支援)
- [ ] 階段 3: 音訊視覺化
- [x] 階段 4: 歌詞顯示 (YouTube CC + LRCLIB 備援)
- [ ] 階段 5: 曲風主題
- [ ] 階段 6: 播放清單管理
- [x] 階段 7: Session 快取系統 (前端 IndexedDB 200首/2GB)
- [ ] 階段 8: 遠端控制
- [ ] 階段 9: 優化與測試
- [ ] 階段 10: 部署

## 📋 待辦事項 (TODO)

### 歌詞功能增強
- [x] 手動歌詞搜尋：允許使用者輸入關鍵字搜尋 LRCLIB，並選擇正確的歌詞版本
- [x] 歌詞選擇記錄：儲存使用者為每首歌選擇的歌詞 ID，下次自動載入
- [x] 歌詞時間偏移記錄：儲存每首歌的時間微調值，下次播放自動套用

### 播放體驗優化
- [x] 串流優先播放：未快取時直接串流播放，不等待下載完成
- [x] 快取狀態顯示：每首歌顯示來源標籤（快取/網路）
- [x] 背景自動快取：播放時背景下載並快取音訊

## 📝 免責聲明

本專案僅供**個人學習與非商業用途**。使用者需自行遵守 YouTube 服務條款及當地法規。快取功能僅用於改善播放體驗，非永久儲存。

## 📄 授權

MIT License
