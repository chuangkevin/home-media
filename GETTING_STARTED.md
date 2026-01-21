# 🚀 開始使用

## 方式 1: 使用 Docker (推薦)

### 前置需求
- Docker
- Docker Compose

### 快速啟動

```bash
# 1. Clone 專案
git clone <your-repo-url>
cd home-media

# 2. 設定環境變數 (可選)
cp .env.example backend/.env
# 編輯 backend/.env 填入您的設定（如 API keys）

# 3. 啟動容器
docker-compose up -d

# 4. 查看日誌
docker-compose logs -f

# 5. 存取應用
# 前端: http://localhost
# 後端 API: http://localhost:3001
# Health check: http://localhost:3001/health
```

### Docker 常用指令

```bash
# 停止容器
docker-compose down

# 重新建置並啟動
docker-compose up -d --build

# 查看執行中的容器
docker-compose ps

# 進入後端容器
docker-compose exec backend sh

# 清理所有資料（包含快取和資料庫）
docker-compose down -v
```

---

## 方式 2: 本地開發

### 前置需求
- Node.js 18+
- npm 或 yarn

### 啟動後端

```bash
cd backend

# 安裝依賴
npm install

# 設定環境變數
cp .env.example .env
# 編輯 .env 填入您的設定

# 開發模式 (hot reload)
npm run dev

# 或建置後執行
npm run build
npm start
```

後端將在 `http://localhost:3001` 啟動

### 啟動前端

```bash
cd frontend

# 安裝依賴
npm install

# 開發模式 (hot reload)
npm run dev

# 或建置後預覽
npm run build
npm run preview
```

前端將在 `http://localhost:5173` 啟動

---

## 📁 專案結構

```
home-media/
├── backend/              # Node.js Express 後端
│   ├── src/
│   │   ├── server.ts     # 入口點
│   │   ├── config/       # 設定檔
│   │   ├── services/     # 業務邏輯
│   │   ├── controllers/  # API 控制器
│   │   ├── models/       # 資料模型
│   │   └── middleware/   # 中間件
│   ├── Dockerfile
│   └── package.json
│
├── frontend/             # React + Vite 前端
│   ├── src/
│   │   ├── App.tsx       # 根元件
│   │   ├── main.tsx      # 入口點
│   │   ├── components/   # UI 元件
│   │   ├── hooks/        # React Hooks
│   │   ├── store/        # Redux Store
│   │   └── styles/       # 樣式
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
│
├── docker-compose.yml    # Docker 編排檔案
├── data/                 # 持久化資料（Docker volumes）
│   ├── cache/            # 音樂快取
│   └── db/               # SQLite 資料庫
└── .env.example          # 環境變數範例
```

---

## 🔧 環境變數說明

編輯 `backend/.env` 檔案：

```bash
# 伺服器設定
NODE_ENV=development          # production | development
PORT=3001                     # HTTP API 埠號
WS_PORT=3002                  # WebSocket 埠號（可選）

# 資料庫
DB_PATH=./data/db/home-media.sqlite

# 快取設定
CACHE_DIR=./data/cache
MAX_CACHE_TRACKS=50           # 最多快取 50 首歌

# API Keys (選用 - 用於歌詞功能)
GENIUS_API_KEY=               # Genius 歌詞 API Key
MUSIXMATCH_API_KEY=           # Musixmatch API Key (選用)

# CORS
ALLOWED_ORIGINS=http://localhost:5173,http://localhost

# 日誌
LOG_LEVEL=info                # error | warn | info | debug
```

### 如何取得 API Keys

#### Genius API Key (用於歌詞)
1. 訪問 https://genius.com/api-clients
2. 建立新的 API Client
3. 取得 Client Access Token
4. 填入 `GENIUS_API_KEY`

> **注意**: Genius API 是選用的。即使沒有 API Key，系統仍可從 YouTube 字幕獲取歌詞。

---

## ✅ 驗證安裝

### 測試後端

```bash
# 方式 1: 使用 curl
curl http://localhost:3001/health

# 方式 2: 使用瀏覽器
# 訪問 http://localhost:3001/health
# 應該看到: {"status":"ok","timestamp":"...","environment":"development"}

# 測試 API 根路徑
curl http://localhost:3001/api
```

### 測試前端

1. 訪問 `http://localhost:5173` (開發模式) 或 `http://localhost` (Docker)
2. 應該看到「家用多媒體中心」首頁
3. 確認 API 狀態顯示 ✅ 連接成功

---

## 🐛 疑難排解

### 問題 1: 後端無法啟動
```bash
# 檢查埠號是否被佔用
netstat -ano | findstr :3001

# 更改埠號
# 編輯 backend/.env，設定 PORT=3002
```

### 問題 2: 前端無法連接後端
```bash
# 檢查 Vite proxy 設定
# 編輯 frontend/vite.config.ts
# 確認 proxy target 指向正確的後端位址
```

### 問題 3: Docker 建置失敗
```bash
# 清除 Docker 快取並重新建置
docker-compose down
docker system prune -a
docker-compose up -d --build
```

### 問題 4: ytdl-core 錯誤
```bash
# ytdl-core 可能需要更新
cd backend
npm update ytdl-core

# 或手動安裝最新版
npm install ytdl-core@latest
```

---

## 📝 下一步

階段 1（基礎設施）已完成！接下來的開發階段：

1. **階段 2**: YouTube 整合 - 搜尋與播放功能
2. **階段 3**: 音訊視覺化 - Web Audio API 整合
3. **階段 4**: 歌詞顯示 - 同步歌詞滾動
4. **階段 5**: 曲風主題 - 動態 UI 主題切換
5. **階段 6**: 播放清單管理
6. **階段 7**: Session 快取系統
7. **階段 8**: 遠端控制
8. **階段 9-10**: 優化、測試與部署

---

## 📚 參考資源

- [ytdl-core 文檔](https://github.com/fent/node-ytdl-core)
- [youtube-sr 文檔](https://github.com/DevSnowflake/youtube-sr)
- [Express 文檔](https://expressjs.com/)
- [React 文檔](https://react.dev/)
- [Redux Toolkit 文檔](https://redux-toolkit.js.org/)
- [Material-UI 文檔](https://mui.com/)
- [Web Audio API 文檔](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
