#!/bin/bash

echo "============================================="
echo "Starting LOCAL DEVELOPMENT servers for macOS..."
echo "============================================="
echo ""

# 獲取當前腳本所在的目錄，確保路徑正確
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Backend Server ---
echo "[1/2] Starting Backend Server (Node.js + Express + TypeScript)"
echo "      Port: http://localhost:3001"
echo "      Using: nodemon + ts-node"
echo ""

# 使用 osascript 在新的 Terminal 視窗中執行後端啟動命令
# 這比模擬按鍵更可靠，且通常不需要特殊的輔助功能權限
osascript <<EOD
tell application "Terminal"
    activate
    do script "cd \"$PROJECT_ROOT/backend\"; echo '--- Starting Backend Server ---'; npm install && npm run dev"
end tell
EOD

# 等待一小段時間讓後端服務有時間啟動
sleep 3

# --- Frontend Server ---
echo "[2/2] Starting Frontend Server (React + Vite)"
echo "      Port: http://localhost:5173"
echo "      Using: Vite HMR"
echo ""

# 在另一個新視窗中啟動前端
osascript <<EOD
tell application "Terminal"
    activate
    do script "cd \"$PROJECT_ROOT/frontend\"; echo '--- Starting Frontend Server ---'; npm install && npm run dev"
end tell
EOD

echo ""
echo "============================================="
echo "Both servers are starting in new terminal windows!"
echo "============================================="
echo ""
echo "Backend:  http://localhost:3001"
echo "Frontend: http://localhost:5173"
echo ""
echo "You can close this window now. The servers are running in other windows."
