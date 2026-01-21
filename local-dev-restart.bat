@echo off
echo =============================================
echo Restarting LOCAL DEVELOPMENT servers...
echo =============================================
echo.

echo [Step 1] Stopping existing servers...
call local-dev-stop.bat

echo.
echo [Step 2] Waiting for ports to be released...
timeout /t 3 /nobreak >nul

echo.
echo [Step 3] Starting servers...
call local-dev-start.bat
