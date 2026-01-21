@echo off
echo =============================================
echo Stopping LOCAL DEVELOPMENT servers...
echo =============================================
echo.

echo Searching for running servers...
echo.

REM 停止後端服務 (Port 3001)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001"') do (
    echo Stopping Backend Server (PID: %%a)
    taskkill /F /PID %%a >nul 2>&1
)

REM 停止前端服務 (Port 5173)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173"') do (
    echo Stopping Frontend Server (PID: %%a)
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo =============================================
echo All servers stopped!
echo =============================================
echo.
pause
