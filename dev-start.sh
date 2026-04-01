#!/bin/bash
# 啟動 production build 的 backend + frontend preview
# Usage: bash dev-start.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔄 Killing existing processes on ports 3001, 4173..."
if command -v powershell &>/dev/null; then
  powershell -Command "Get-NetTCPConnection -LocalPort 3001,4173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>/dev/null
else
  lsof -ti:3001,4173 | xargs kill -9 2>/dev/null
fi
sleep 1

echo "🔨 Building backend..."
cd backend && npm run build 2>&1 | tail -3
echo "🔨 Building frontend..."
cd ../frontend && npm run build 2>&1 | tail -3
cd ..

echo "🚀 Starting backend (production)..."
cd backend && NODE_ENV=production node dist/server.js &
BACKEND_PID=$!

echo "🚀 Starting frontend preview..."
cd ../frontend && npx vite preview --port 4173 &
FRONTEND_PID=$!

echo ""
echo "✅ Services started:"
echo "   Backend:  http://localhost:3001 (PID: $BACKEND_PID)"
echo "   Frontend: http://localhost:4173 (PID: $FRONTEND_PID)"
echo ""
echo "Press Ctrl+C to stop all services"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo '🛑 Stopped'; exit" INT TERM
wait
