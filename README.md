# 🎵 家用多媒體中心

一個功能完整的 YouTube 音樂與影片播放中心，支援線上串流、歌詞同步、音訊視覺化、電台廣播、跨裝置控制。

## ✨ 核心特色

- ✅ **無需 API Key** - 使用 yt-dlp 爬蟲技術，無需 YouTube API Key
- ✅ **零設定部署** - Docker 一鍵啟動，無需額外設定（推薦功能開箱即用）
- ✅ **無廣告音訊** - 直接提取純音訊串流，過濾所有廣告
- ✅ **智慧推薦首頁** - 基於收聽記錄的混合推薦（頻道推薦 + 智慧推薦），支援無限滾動
- ✅ **自動播放佇列** - 播放完畢自動載入推薦曲目，無盡播放體驗
- ✅ **線上串流優先** - yt-dlp 直接串流播放，搜尋結果背景預快取
- ✅ **雙層快取** - 伺服器端磁碟快取 (LRU, 10GB) + 前端 IndexedDB 快取
- ✅ **影片/視覺化切換** - 支援 YouTube 影片嵌入播放與音訊視覺化模式
- ✅ **歌詞同步滾動** - 支援 YouTube CC、LRCLIB、NetEase（網易雲）、手動搜尋與時間微調
- ✅ **全螢幕歌詞模式** - 沉浸式歌詞體驗，支援歌詞來源切換與時間偏移調整
- ✅ **歌詞偏好跨裝置同步** - 選擇的歌詞來源與時間偏移自動同步到所有裝置
- ✅ **播放清單管理** - 建立、編輯、匯入/匯出播放清單
- ✅ **電台廣播模式** - DJ 開台即時同步播放、曲目、顯示模式給聽眾
- ✅ **跨裝置投射** - 手機、平板投射歌曲到其他裝置播放
- ✅ **系統管理頁面** - 主題設定、功能開關、快取管理與清除
- ✅ **頻道隱藏** - 隱藏不感興趣的頻道，不再出現在推薦中
- ✅ **URL 路由** - 支援 React Router，頁面重整保留播放狀態

## 🏗️ 技術架構

### 後端
- **Node.js** + **Express** + **TypeScript**
- **yt-dlp** (`youtube-dl-exec`) - YouTube 搜尋與音訊串流 (直接 stdout pipe，避免 403)
- **SQLite** (`better-sqlite3`) - 搜尋快取、播放記錄、播放清單
- **Socket.io** - WebSocket 即時通訊 (投射、電台)

### 前端
- **React 18** + **Vite** + **TypeScript**
- **Redux Toolkit** - 狀態管理
- **Web Audio API** - 音訊分析與視覺化
- **YouTube IFrame API** - 影片嵌入播放
- **Material-UI** - UI 元件庫

### 部署
- **Docker** + **docker-compose**
- **Nginx** - 反向代理
- **GitHub Actions** - 自動建置並推送至 DockerHub

## 🚀 快速開始

### Raspberry Pi 部署 (推薦)

DockerHub 上已有預建映像檔 (支援 arm64)：

```bash
# 下載 docker-compose.yml
curl -O https://raw.githubusercontent.com/chuangkevin/home-media/main/docker-compose.yml

# 啟動服務
docker compose up -d

# 存取應用
# http://<your-rpi-ip>:3123
```

**🎵 選用功能：** 想要 Spotify 增強推薦？查看 [SPOTIFY_SETUP.md](SPOTIFY_SETUP.md) 快速設定指南。

### 本機 Docker 開發

```bash
# Clone 專案
git clone https://github.com/chuangkevin/home-media.git
cd home-media

# 建置並啟動
docker compose up -d --build

# 存取應用: http://localhost:3123
```

### 本地開發

#### Windows 用戶 (推薦)

直接雙擊執行批次檔案：

```bash
# 啟動前後端服務
local-dev-start.bat

# 停止所有服務
local-dev-stop.bat
```

服務啟動後：

- **前端**: `http://localhost:5173`
- **後端 API**: `http://localhost:3001`

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

## 🔧 疑難排解

### YouTube 403 錯誤（無法播放）

本專案使用 **yt-dlp 直接串流**（stdout pipe）播放音訊，避免提取 URL 後被 YouTube 封鎖。

如果仍遇到 403 錯誤，通常是 yt-dlp 版本過舊：

```bash
# Docker 部署：重新拉取映像（內含最新 yt-dlp）
docker compose down && docker compose pull && docker compose up -d

# 本地開發：手動更新 yt-dlp
cd backend
npx --yes youtube-dl-exec --update
# 或直接執行 yt-dlp 更新
node_modules/youtube-dl-exec/bin/yt-dlp --update
```

如果問題持續，可能是 YouTube 更新了封鎖機制，請檢查 [GitHub Issues](https://github.com/chuangkevin/home-media/issues)。

## 📁 專案結構

```text
home-media/
├── backend/              # Node.js 後端
│   ├── src/
│   │   ├── services/     # YouTube、歌詞、音訊快取、推薦、電台服務
│   │   ├── controllers/  # API 控制器
│   │   ├── handlers/     # WebSocket 事件處理 (投射、電台)
│   │   ├── config/       # 環境設定、資料庫初始化
│   │   ├── routes/       # Express 路由 (搜尋、歌詞、推薦、隱藏頻道...)
│   │   └── utils/        # Logger 等工具
│   └── Dockerfile
│
├── frontend/             # React 前端
│   ├── src/
│   │   ├── components/   # UI 元件
│   │   │   ├── Player/   # 播放器、全螢幕歌詞
│   │   │   ├── Home/     # 首頁混合推薦
│   │   │   ├── Radio/    # 電台廣播
│   │   │   ├── Playlist/ # 播放清單
│   │   │   └── Admin/    # 系統管理
│   │   ├── hooks/        # React Hooks (useRadio, useAutoQueue...)
│   │   ├── store/        # Redux Store (player, radio slices)
│   │   └── services/     # API、Socket.io、快取服務
│   └── Dockerfile
│
├── docker-compose.yml    # Docker 編排
└── data/                 # 持久化資料
    ├── audio-cache/      # 伺服器端音訊快取 (LRU, 10GB)
    └── db/               # SQLite 資料庫
```

## 🎯 開發路線圖

- [x] 階段 1: 基礎設施
- [x] 階段 2: YouTube 整合 (yt-dlp 搜尋、串流、中文標題支援)
- [x] 階段 3: 音訊視覺化
- [x] 階段 4: 歌詞顯示 (YouTube CC + LRCLIB + NetEase + 手動搜尋)
- [x] 階段 5: 曲風主題與智慧推薦
  - [x] 資料庫架構擴充 (tags, genres, audio_features, spotify_id 等欄位)
  - [x] YouTube metadata 提取增強 (tags, categories, description, language)
  - [x] 智慧推薦系統 (自動適配 YouTube-only 或 Spotify 增強模式)
  - [x] API endpoints: `/api/recommendations/similar/:videoId`, `/api/recommendations/genres`
  - [x] 混合推薦首頁 (頻道推薦 + 智慧推薦，無限滾動)
  - [x] 自動播放佇列 (播放完自動加入推薦曲目，無盡播放)
  - [x] 頻道隱藏功能 (從推薦中移除不感興趣的頻道)

  **推薦引擎** (零設定即可用):
  - **YouTube-only 模式** (預設，無需設定):
    - 50% YouTube tags 相似度
    - 30% 同頻道加權
    - 20% 標題文字相似度
  - **Spotify 增強模式** (選用，需設定 API):
    - 40% 曲風匹配 (pop, rock, jazz, etc.)
    - 30% 音訊特徵 (danceability, energy, valence...)
    - 20% YouTube tags
    - 10% 同頻道
    - 設定說明: [backend/SPOTIFY_INTEGRATION.md](backend/SPOTIFY_INTEGRATION.md)
- [x] 階段 6: 播放清單管理
- [x] 階段 7: 快取系統 (伺服器端磁碟 10GB + 前端 IndexedDB)
- [x] 階段 8: 遠端控制 (Socket.io 投射功能)
- [x] 階段 9: 電台廣播 (DJ/聽眾即時同步，斷線自動重連)
- [x] 階段 10: Docker 部署 + GitHub Actions CI/CD (原生 ARM64 建置)
- [x] 階段 11: 影片模式 (YouTube IFrame 嵌入 + 音訊/影片切換)
- [x] 階段 12: 伺服器端預快取 (搜尋結果背景下載)
- [x] 階段 13: 歌詞系統強化
  - [x] 全螢幕歌詞模式 (沉浸式體驗，響應式佈局)
  - [x] 歌詞來源切換 (LRCLIB、NetEase、YouTube CC)
  - [x] 歌詞偏好跨裝置同步 (LRCLIB ID / NetEase ID / 時間偏移)
  - [x] 播放優先策略 (未快取時延遲歌詞搜尋，避免搶佔串流資源)
- [x] 階段 14: 系統管理與路由
  - [x] 系統管理頁面 (主題、功能開關、快取管理)
  - [x] React Router URL 路由 (頁面重整保留播放狀態)
- [ ] 階段 15: 播放效能優化
  - [ ] 預測性預載 (AI 預測下一首並預先載入)
  - [ ] CDN 整合 (全球加速)
  - [ ] Adaptive Bitrate (根據網路速度調整音質)

## 📝 免責聲明

本專案僅供**個人學習與非商業用途**。使用者需自行遵守 YouTube 服務條款及當地法規。快取功能僅用於改善播放體驗，非永久儲存。

## 📄 授權

MIT License
