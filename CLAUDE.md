# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Home Media 是一個 YouTube 音樂串流平台，提供類似 Spotify/YouTube Music 的體驗，包含 KTV 歌詞、AI 翻譯、音頻視覺化等功能。

## Architecture

- **Backend**: Express.js + TypeScript + SQLite (better-sqlite3 WAL mode)
- **Frontend**: React 18 + Redux Toolkit + MUI 5 + Vite
- **Deployment**: Docker Compose (backend + nginx frontend) via GitHub Actions + Tailscale SSH

## Development Commands

```bash
# Backend (port 3001)
cd backend && npm run dev    # nodemon + ts-node hot-reload

# Frontend (port 5173, proxies /api → 3001)
cd frontend && npm run dev   # vite dev server

# Build
cd backend && npm run build  # TypeScript → dist/
cd frontend && npm run build # Vite → dist/

# Docker
docker compose up -d         # Production (frontend on :3123)
```

## Key Services & Data Flow

### Audio Playback
1. Frontend checks IndexedDB cache → Blob URL 秒開（cached path）
2. Fallback: stream from `/api/stream/:videoId` (yt-dlp)（streaming path）
3. Background: immediately download stream to IndexedDB（不等 backend cache）
4. Stream→Blob switch: seamless src swap, enables lock-screen playback
5. `currentVideoIdRef` MUST be set in both cached/streaming paths

### Lyrics Pipeline
Cache → User Preference (LRCLIB/NetEase ID) → Local IndexedDB → Backend auto-search
Backend order: SQLite cache → NetEase → LRCLIB → Genius → YouTube CC (parallel with traditional)

Title cleaning (regex fallback when Gemini unavailable):
- Removes `[...]` brackets, `(Official Video)`, Japanese `「」『』` brackets
- Must clean BEFORE extracting from Chinese brackets `【】`
- Handles anime tags: `[TVアニメ...]`, `エンディングテーマ` etc.

### AI Translation (Gemini 2.5 Flash)
- Up to 41 API keys with random selection + 30s bad-key cooldown
- `getMaxRetries()` = min(keyCount, 5) — retries with different keys
- All keys bad → `badKeys.clear()` resets everything
- Translation cached in `lyrics_translations` table with content hash validation
- Max 200 lines per request (truncates longer lyrics)
- Mixed language: translates per-line independently, compares with original
- Frontend retry: 4 attempts × 15s interval (matches 30s cooldown)

### SponsorBlock
- Fetches skip segments on track load
- Cached path: pre-loads segments before play, seeks past intro
- Streaming path: checks buffer range before seeking (prevents infinite loop)
- `skippedSegmentsRef` (Set) prevents re-skip of same segment

### Playlist (YouTube-style)
- `playNow(track)`: inserts after currentIndex, plays immediately, re-locates currentIndex after filter
- `appendToPlaylist(tracks)`: auto-queue adds to end without disrupting
- `playNext/playPrevious`: stable index navigation
- `confirmPendingTrack`: finds track by `videoId` (not `id`)

### Search
- Backend: youtube-sr (primary) → yt-dlp (fallback), 50 results
- Frontend: autocomplete via YouTube suggestqueries API (300ms debounce)
- Search results: lazy load 12 items at a time (IntersectionObserver)
- Recent searches stored in localStorage

### Video Playback
- Download-first: `bv*[height<=720]+ba` format (flexible, not strict mp4+m4a)
- `--no-part` flag to avoid .part file residue
- Video tab only enables after download complete

## Critical Patterns

### AudioPlayer.tsx (most complex file)
- Two playback paths: **cached** (IndexedDB → Blob URL) and **streaming** (yt-dlp)
- Cached path MUST: set `currentVideoIdRef`, revoke old blob URL, call `audio.play()`
- `pendingTrack` → `confirmPendingTrack()` → `currentTrack` lifecycle
- DisplayMode effect: only restore audio when `prevDisplayModeRef` was 'video'
- Background Blob switch: download immediately from stream URL, don't wait for backend cache
- Lock screen: Blob URL required (streaming URL breaks on screen lock)

### yt-dlp
- Requires `--js-runtimes node:{process.execPath}` (YouTube changed API)
- Base args in `youtubeService.getYtDlpBaseArgs()` include cookies + headers
- `getVideoInfo` uses yt-dlp `--dump-json` (ytdl-core is deprecated)
- Must keep yt-dlp updated (`--update`)

### Gemini API Key Management
- Keys from env `GEMINI_API_KEY` + DB `settings.gemini_api_keys`
- `getApiKey()`: random good key → if all bad, clears ALL bad marks
- `markKeyBad()`: 30s cooldown per key
- `getMaxRetries()`: min(keyCount, 5)

### Immersive Lyrics (MorrorLyrics)
- White text + black outline (subtitle style) — works on any background
- CSS variable `--lyrics-dim-color` for CharByChar animations
- 6 effects: karaoke, scale, typewriter, neon, wave, focus
- Audio visualizer canvas with frequency bars

## Database

SQLite at `./data/db/home-media.sqlite` (WAL mode). Key tables:
- `cached_tracks` - play/skip/complete counts, metadata
- `lyrics_cache` - lyrics by source with timestamps
- `lyrics_translations` - AI translations with `lines_hash` validation
- `lyrics_preferences` - user's preferred lyrics source per video
- `settings` - key-value config (including Gemini API keys)

## Ports

| Port | Service |
|------|---------|
| 3001 | Backend API |
| 3002 | WebSocket (Socket.io) |
| 5173 | Frontend dev (Vite) |
| 3123 | Frontend prod (nginx in Docker) |

## CI/CD

- Build: GitHub Actions → Docker Hub (kevin950805/home-media-*)
- Deploy: Tailscale SSH → docker compose up -d --force-recreate
- Health check: SSH curl localhost:3001/health, 24 attempts × 5s (120s total)
- Container startup takes 60-90s (Node.js + DB init)

## Things That Break Easily

- **UI positioning**: Never change player/drawer heights without understanding the full layout chain (AudioPlayer bottom, BottomNav, Drawer, safe-area-inset)
- **Lyrics abort**: `getLyrics()` has AbortController — preloading must use `getLyricsForPreload()` instead
- **Translation cache**: keyed by videoId + lines_hash — changing lyrics source invalidates cache automatically
- **yt-dlp version**: must be kept updated, older versions can't extract YouTube data
- **playNow filter**: after removing duplicates from playlist, must re-locate currentIndex
- **Cached playback**: must set currentVideoIdRef + call audio.play() (both were missing before)
- **SponsorBlock + streaming**: must check buffer range before seeking (prevents infinite loop)
- **Background Blob switch**: must download immediately, not wait for backend cache (causes lock-screen silence)
