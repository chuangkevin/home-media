# 家用多媒體中心

一個功能完整的音樂與影片播放中心，支援線上串流、歌詞同步、AI 翻譯、沉浸式視覺化、電台廣播、跨裝置控制。

## 核心特色

- **無廣告音訊** - 直接提取純音訊串流，過濾所有廣告
- **智慧推薦** - 基於收聽記錄與曲風的 AI 推薦，搭配 Gemini 智慧搜尋
- **自動播放佇列** - 播放完畢自動載入推薦曲目，無盡播放體驗
- **搜尋自動完成** - 即時搜尋建議，300ms debounce，支援歷史記錄
- **雙層快取** - 伺服器端磁碟快取 + 前端 IndexedDB 快取，秒開播放
- **歌詞同步滾動** - 支援 LRCLIB、NetEase（網易雲）、CC 字幕、手動搜尋與時間微調
- **AI 歌詞翻譯** - Gemini 2.5 Flash 逐行翻譯，中英混合歌詞智慧處理
- **沉浸式歌詞** - 6 種視覺特效（逐字填色、霓虹、打字機等）+ 音頻視覺化
- **影片播放** - 720p 影片下載快取，智慧保留策略
- **SponsorBlock** - 自動跳過非音樂段落（廣告、片頭、片尾）
- **鎖屏播放** - 背景 Blob URL 切換，支援 iOS/Android 鎖屏控制
- **播放清單管理** - 建立、編輯、匯入/匯出播放清單
- **電台廣播** - DJ 開台即時同步播放給聽眾
- **跨裝置投射** - 手機、平板投射歌曲到其他裝置播放
- **PWA 支援** - 可安裝為桌面/手機 App，支援 safe-area
- **零設定部署** - Docker 一鍵啟動

## 技術架構

### 後端

- **Node.js** + **Express** + **TypeScript**
- **yt-dlp** - 音訊/影片串流與搜尋
- **SQLite** (`better-sqlite3`) - 快取、播放記錄、歌詞、翻譯
- **Socket.io** - WebSocket 即時通訊（投射、電台）
- **Gemini 2.5 Flash** - AI 歌詞翻譯、曲風分析、標題提取

### 前端

- **React 18** + **Vite** + **TypeScript**
- **Redux Toolkit** - 狀態管理
- **Web Audio API** - 音訊分析與視覺化（頻率條、低音光暈、節拍粒子）
- **Material-UI** - UI 元件庫
- **IndexedDB** - 前端音訊/歌詞快取

### 部署

- **Docker** + **docker-compose**
- **Nginx** - 反向代理
- **GitHub Actions** - CI/CD 自動建置推送至 DockerHub
- **Tailscale** - 安全遠端部署

## 快速開始

### Docker 部署（推薦）

```bash
# 下載設定檔
curl -O https://raw.githubusercontent.com/chuangkevin/home-media/main/docker-compose.yml

# 啟動服務
docker compose up -d

# 存取應用: http://<your-ip>:3123
```

### 本地開發

```bash
git clone https://github.com/chuangkevin/home-media.git
cd home-media

# 後端
cd backend && npm install && npm run dev

# 前端（另一個終端）
cd frontend && npm install && npm run dev

# 前端: http://localhost:5173
# 後端: http://localhost:3001
```

## 專案結構

```text
home-media/
├── backend/              # Node.js 後端
│   ├── src/
│   │   ├── services/     # 音訊串流、歌詞、快取、推薦、AI 翻譯
│   │   ├── controllers/  # API 控制器
│   │   ├── handlers/     # WebSocket 事件處理（投射、電台）
│   │   ├── config/       # 環境設定、資料庫初始化
│   │   └── routes/       # Express 路由
│   └── Dockerfile
│
├── frontend/             # React 前端
│   ├── src/
│   │   ├── components/   # UI 元件
│   │   │   ├── Player/   # 播放器、歌詞、沉浸模式
│   │   │   ├── Home/     # 首頁推薦
│   │   │   ├── Search/   # 搜尋（自動完成 + lazy load）
│   │   │   ├── Radio/    # 電台廣播
│   │   │   ├── Playlist/ # 播放清單
│   │   │   └── Admin/    # 系統管理
│   │   ├── hooks/        # useAutoQueue, useAudioAnalyser...
│   │   ├── store/        # Redux（player, radio, recommendation）
│   │   └── services/     # API、Socket.io、快取
│   └── Dockerfile
│
├── docker-compose.yml
├── CLAUDE.md             # AI 開發指南
└── data/                 # 持久化資料
    ├── audio-cache/      # 音訊快取
    ├── video-cache/      # 影片快取
    └── db/               # SQLite 資料庫
```

## 免責聲明

本專案僅供**個人學習與非商業用途**。使用者需自行遵守相關服務條款及當地法規。快取功能僅用於改善播放體驗，非永久儲存。

## 授權

MIT License
