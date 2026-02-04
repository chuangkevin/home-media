@echo off
REM Spotify API Integration Test Script (Windows)
REM This script tests the Spotify API endpoints

set BASE_URL=http://localhost:3001/api

echo.
echo 🎵 Testing Spotify API Integration
echo ==================================

REM 1. Check Spotify configuration status
echo.
echo 1️⃣ Checking Spotify API status...
curl -s "%BASE_URL%/spotify/status"

REM 2. Get available genres
echo.
echo.
echo 2️⃣ Fetching available genres...
curl -s "%BASE_URL%/recommendations/genres"

REM Example: Enrich a specific track (uncomment and replace VIDEO_ID)
REM set VIDEO_ID=dQw4w9WgXcQ
REM echo.
REM echo.
REM echo 3️⃣ Enriching track %VIDEO_ID%...
REM curl -X POST -s "%BASE_URL%/spotify/enrich/%VIDEO_ID%"

REM Example: Get recommendations
REM set VIDEO_ID=dQw4w9WgXcQ
REM echo.
REM echo.
REM echo 4️⃣ Getting recommendations for %VIDEO_ID%...
REM curl -s "%BASE_URL%/recommendations/similar/%VIDEO_ID%?limit=5"

REM Example: Get tracks by genre
REM set GENRE=pop
REM echo.
REM echo.
REM echo 5️⃣ Getting tracks in genre: %GENRE%...
REM curl -s "%BASE_URL%/recommendations/genre/%GENRE%?limit=10"

echo.
echo.
echo ✅ Test complete!
echo.
echo To test enrichment, first play some songs in the app, then:
echo   1. Get video IDs from /api/history/searches
echo   2. Call POST /api/spotify/enrich/:videoId for each track
echo   3. Or use batch enrichment: POST /api/spotify/enrich-batch
echo.
echo For detailed setup instructions, see: backend\SPOTIFY_INTEGRATION.md
echo.
pause
