@echo off
REM 啟動 production build 的 backend + frontend
REM 用法: 雙擊或在 terminal 執行 dev-start.bat

echo [36m🔄 Killing existing processes...[0m
powershell -Command "Get-NetTCPConnection -LocalPort 3001,4173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
timeout /t 1 /nobreak >nul

echo [33m🔨 Building backend...[0m
cd /d %~dp0backend
call npm run build
if errorlevel 1 (
    echo [31m❌ Backend build failed[0m
    pause
    exit /b 1
)

echo [33m🔨 Building frontend...[0m
cd /d %~dp0frontend
call npm run build
if errorlevel 1 (
    echo [31m❌ Frontend build failed[0m
    pause
    exit /b 1
)

echo [32m🚀 Starting backend (production)...[0m
cd /d %~dp0backend
start /b cmd /c "set NODE_ENV=production && node dist/server.js"

echo [32m🚀 Starting frontend preview...[0m
cd /d %~dp0frontend
start /b cmd /c "npx vite preview --port 4173"

echo.
echo [32m✅ Services started:[0m
echo    Backend:  http://localhost:3001
echo    Frontend: http://localhost:4173
echo.
echo Press any key to stop all services...
pause >nul

echo [31m🛑 Stopping...[0m
powershell -Command "Get-NetTCPConnection -LocalPort 3001,4173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" 2>nul
echo Done.
