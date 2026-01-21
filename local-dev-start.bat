@echo off
echo =============================================
echo Starting LOCAL DEVELOPMENT servers for Windows...
echo =============================================
echo.

echo [1/2] Starting Backend Server (Node.js + Express + TypeScript)
echo       Port: http://localhost:3001
echo       Using: nodemon + ts-node
echo.
start "Home Media - Backend Dev Server" cmd /c "cd /d D:\Projects\home-media\backend && npm install && npm run dev"

timeout /t 2 /nobreak >nul

echo [2/2] Starting Frontend Server (React + Vite)
echo       Port: http://localhost:5173
echo       Using: Vite HMR
echo.
start "Home Media - Frontend Dev Server" cmd /c "cd /d D:\Projects\home-media\frontend && npm install && npm run dev"

echo.
echo =============================================
echo Both servers are starting in new windows!
echo =============================================
echo.
echo Backend:  http://localhost:3001
echo Frontend: http://localhost:5173
echo.
echo Press any key to close this window...
pause >nul
