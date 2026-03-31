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
1. Frontend checks IndexedDB cache → Blob URL 秒開
2. Fallback: stream from `/api/stream/:videoId` (yt-dlp)
3. Background: download to IndexedDB for next time
4. Stream→Blob switch: seamless src swap during playback

### Lyrics Pipeline
Cache → User Preference (LRCLIB/NetEase ID) → Local IndexedDB → Backend auto-search
Backend order: SQLite cache → NetEase → LRCLIB → Genius → YouTube CC (parallel with traditional)

### AI Translation (Gemini 2.5 Flash)
- 6 API keys with random selection + 30s bad-key cooldown
- Translation cached in `lyrics_translations` table with content hash validation
- Max 200 lines per request (truncates longer lyrics)
- Mixed language: translates per-line independently

### SponsorBlock
- Fetches skip segments on track load
- Cached path: pre-loads segments before play, seeks past intro
- Streaming path: checks buffer range before seeking

### Playlist (YouTube-style)
- `playNow(track)`: inserts after currentIndex, plays immediately
- `appendToPlaylist(tracks)`: auto-queue adds to end without disrupting
- `playNext/playPrevious`: stable index navigation

## Critical Patterns

### AudioPlayer.tsx (most complex file)
- Two playback paths: **cached** (IndexedDB → Blob URL) and **streaming** (yt-dlp)
- `currentVideoIdRef` MUST be set in both paths (caused wrong-song bug)
- `pendingTrack` → `confirmPendingTrack()` → `currentTrack` lifecycle
- SponsorBlock: `skippedSegmentsRef` (Set) prevents re-skip loops
- DisplayMode effect: only restore audio when `prevDisplayModeRef` was 'video'

### yt-dlp
- Requires `--js-runtimes node:{process.execPath}` (YouTube changed API)
- Base args in `youtubeService.getYtDlpBaseArgs()` include cookies + headers
- `getVideoInfo` uses yt-dlp `--dump-json` (ytdl-core is deprecated)

### Gemini API Key Management
- Keys from env `GEMINI_API_KEY` + DB `settings.gemini_api_keys`
- `getApiKey()`: random good key → if all bad, clears ALL bad marks
- `markKeyBad()`: 30s cooldown per key

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

## Things That Break Easily

- **UI positioning**: Never change player/drawer heights without understanding the full layout chain (AudioPlayer bottom, BottomNav, Drawer, safe-area-inset)
- **Lyrics abort**: `getLyrics()` has AbortController — preloading must use `getLyricsForPreload()` instead
- **Translation cache**: keyed by videoId + lines_hash — changing lyrics source invalidates cache automatically
- **yt-dlp version**: must be kept updated, older versions can't extract YouTube data
