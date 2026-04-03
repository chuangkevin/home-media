# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Home Media 是一個音樂串流平台，提供類似 Spotify 的體驗，包含 KTV 歌詞、AI 翻譯、沉浸式視覺化等功能。

## Architecture

- **Backend**: Express.js + TypeScript + SQLite (better-sqlite3 WAL mode)
- **Frontend**: React 18 + Redux Toolkit + MUI 5 + Vite
- **Deployment**: Docker Compose (backend + nginx frontend) via GitHub Actions + Tailscale SSH
- **Layout**: Flex column (100dvh) — content scrolls independently, player/nav fixed at bottom (not position:fixed, avoids iOS Safari issues)

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
Backend order: SQLite cache → NetEase → LRCLIB → Genius → CC (parallel with traditional)

Title cleaning (regex fallback when Gemini unavailable):
- Removes `[...]` brackets, `(Official Video)`, Japanese `「」『』` brackets
- Must clean BEFORE extracting from Chinese brackets `【】`
- Handles anime tags: `[TVアニメ...]`, `エンディングテーマ` etc.
- `[Music]` tags stripped from line start (not whole line filtered)

### AI Translation (Gemini 2.5 Flash)
- Up to 41 API keys with random selection + 30s bad-key cooldown
- `getMaxRetries()` = min(keyCount, 5) — retries with different keys
- All keys bad → `badKeys.clear()` resets everything
- Translation cached in `lyrics_translations` table with content hash validation
- Max 200 lines per request (truncates longer lyrics)
- Mixed language: translates per-line independently, compares with original
- Frontend retry: 4 attempts × 15s interval (matches 30s cooldown)
- Manual retry: after all auto-retries fail, show "重試翻譯" Chip (FullscreenLyrics + MorrorLyrics)

### Lyrics Realtime Sync (Socket.io)

- Any lyrics change (offset/source) broadcasts to ALL connected devices via `lyrics:offset-changed` / `lyrics:source-changed`
- Backend `lyrics.handler.ts`: `socket.broadcast.emit` (excludes sender)
- Frontend `useLyricsSync` hook: emit on local change, listen for remote changes
- Anti-loop: `isRemoteUpdateRef` flag prevents re-emit on received changes
- `deviceId` (UUID v4 in sessionStorage) for identification
- REST API `updateLyricsPreferences` retained for persistence; socket is real-time push only

### Radio Crossfade

- Dual `<audio>` element architecture (primary/secondary), swap roles after each crossfade
- `useCrossfade` hook: volume animation (16ms interval), preload next track, role swap
- Triggers at `track.duration - 5s`, preloads at `track.duration - 10s`
- Secondary element warm-up on first user interaction (bypasses autoplay)
- Host emits `radio:crossfade-start` → Listener executes local crossfade with elapsedMs adjustment
- Short track guard: skip crossfade if `track.duration < 10s`
- Disabled in video mode; toggle in RadioPanel (localStorage `radio-crossfade-enabled`)
- MediaSession updated only after crossfade completes
- SponsorBlock paused during crossfade

### SponsorBlock
- Fetches skip segments on track load
- Cached path: pre-loads segments before play, seeks past intro
- Streaming path: checks buffer range before seeking (prevents infinite loop)
- `skippedSegmentsRef` (Set) prevents re-skip of same segment

### Playlist
- `playNow(track)`: inserts after currentIndex, plays immediately, re-locates currentIndex after filter
- `appendToPlaylist(tracks)`: auto-queue adds to end without disrupting
- `playNext/playPrevious`: stable index navigation
- `confirmPendingTrack`: finds track by `videoId` (not `id`)
- Search does NOT replace playlist (only updates searchResults state)

### Search
- Backend: youtube-sr (primary) → yt-dlp (fallback), 50 results
- Frontend: autocomplete suggestions API (300ms debounce)
- Search results: lazy load 12 items at a time (IntersectionObserver)
- Recent searches stored in localStorage

### Video Playback
- Download-first: `bv*[height<=720]+ba` format (flexible, not strict mp4+m4a)
- yt-dlp auto-appends `.mp4` extension — temp path must NOT include `.mp4`
- Check both `{id}.tmp` and `{id}.tmp.mp4` when renaming
- Video tab only enables after download complete
- **Audio architecture**: audio element is the ONLY sound source in ALL modes
  - YouTube iframe is always muted (`event.target.mute()`) — visual sync only
  - Cached video uses `<video muted>` element, synced to audio via `onCanPlay` + interval (drift >3s)
  - Audio element must NEVER be paused/muted in video mode (breaks background/lock-screen playback)
  - iframe `onStateChange`: sync position on state=1, force play on state=2/-1, only `playNext` on state=0
  - Seek applies to audio element in all modes; iframe/video follows
  - `handlePlaying` event must NOT mute audio (old architecture remnant removed)
- Duration: use `track.duration` (YouTube metadata) over `audio.duration` or `iframe.getDuration()` to avoid tail silence

### Recommendations
- Two-tier: same artist first (up to 10), then AI-recommended different artists (fill to 20)
- Tier 1: YouTube search `"{artist} songs"`, filter by channel name match
- Tier 2: Gemini AI suggests similar style/genre songs by different artists
- Frontend passes `artist` + `title` as query params (fallback when track not in cached_tracks)
- Auto-queue: triggers when remainingSongs <= 2, uses `videoId:playlistLength` key to prevent duplicates
- Auto-queue waits for metadata (channel non-empty) before triggering — avoids empty artist recommendations
- Uses `pendingTrack || currentTrack` as seed (playNow sets pendingTrack before currentTrack updates)
- `playNow` clears tracks after insert position — forces auto-queue to re-recommend for new artist
- Filter out tracks >600s (10 min) — prevents compilation albums from polluting queue/cache
- Dependencies: `[activeVideoId, currentIndex, playlist.length]`

## Critical Patterns

### AudioPlayer.tsx (most complex file)
- Two playback paths: **cached** (IndexedDB → Blob URL) and **streaming** (yt-dlp)
- Cached path MUST: set `currentVideoIdRef`, revoke old blob URL, call `audio.play()`
- `pendingTrack` → `confirmPendingTrack()` → `currentTrack` lifecycle
- DisplayMode effect: video mode keeps audio playing normally / returning from video is no-op / else normal play-pause
- Background Blob switch: download immediately from stream URL, don't wait for backend cache
- Lock screen: Blob URL required (streaming URL breaks on screen lock)
- Skip/complete stats use `track.duration` (YouTube metadata), not `audio.duration`
- `handleTimeUpdate` dispatches `setCurrentTime` in ALL modes (audio is single time source)
- `updateTrackMetadata` action: updates currentTrack + pendingTrack + playlist without resetting currentTime
- Restore from URL: reads metadata from IndexedDB cache first (avoids '載入中...' placeholder)
- `NotAllowedError` on autoplay: sets `isPlaying(false)` so UI matches (user must click play)

### yt-dlp
- Requires `--js-runtimes node:{process.execPath}` (API changed)
- Base args in `youtubeService.getYtDlpBaseArgs()` include cookies + headers
- `getVideoInfo` uses yt-dlp `--dump-json` (ytdl-core is deprecated)
- Must keep yt-dlp updated (`--update`)

### Gemini API Key Management
- Keys from env `GEMINI_API_KEY` + DB `settings.gemini_api_keys`
- `getApiKey()`: random good key → if all bad, clears ALL bad marks
- `markKeyBad()`: 30s cooldown per key
- `getMaxRetries()`: min(keyCount, 5)

### Immersive Lyrics (MorrorLyrics)
- White text + black outline (2px 八方向描邊) — works on any background
- CSS variable `--lyrics-dim-color` for CharByChar animations
- 6 effects: karaoke, scale, typewriter, neon, wave, focus
- Audio visualizer: Web Audio API on desktop, simulated sine wave fallback on mobile (CORS)
- Canvas resize must defer to `requestAnimationFrame` (layout not ready on mount)

### Preloading
- Next track: starts immediately when current track plays (not at 50%)
- Downloads directly to IndexedDB from stream URL (not waiting for backend cache)
- Background Blob switch: `setIsCached(true)` must be called after switch (updates tag)

### Lyrics Fine-Tune (滑動對準)
- `fineTuneStartTimeRef` records `currentTime` on enter (fixed, doesn't drift)
- Offset = lineTime - fixedStartTime (not lineTime - changing currentTime)
- +/- buttons: ±0.5s per click, long-press for continuous adjustment

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

- Build: GitHub Actions → Docker Hub
- Deploy: Tailscale SSH → docker compose up -d --force-recreate
- Health check: `docker exec` node http check (port not exposed to host), 24 × 5s = 120s
- Container startup takes 60-90s (Node.js + DB init)

### UX Gestures & Navigation

- **Lyrics drawer swipe-down dismiss**: Top header area (drag handle + track info) has touch gesture handlers
  - `touchAction: 'none'` on header prevents scroll interference
  - Drag threshold: 80px downward → `onClose()`
  - Visual feedback: Drawer paper `translateY(dragOffset)` during drag
  - Snap-back: `transition: transform 0.3s ease` when released below threshold
  - `dragOffset` resets on drawer open/close via useEffect
  - Touch handlers ONLY on header area — lyrics content scrolls normally
- **Sticky search bar**: `position: sticky, top: 0, zIndex: 5` in scrollable container
  - `mx: -3, px: 3` extends background to container edges (prevents content bleed-through)
  - Background color: `background.paper` for solid coverage
- **Tab re-click scroll to top**: BottomNav checks `getNavValue() === path` → calls `scrollToTop()`
  - `scrollContainerRef` on the main scrollable `<Box>` in AppContent
  - `scrollTo({ top: 0, behavior: 'smooth' })`

## Things That Break Easily

- **UI positioning**: Uses flex layout (not position:fixed) — don't add transform/will-change to parents
- **Lyrics abort**: `getLyrics()` has AbortController — preloading must use `getLyricsForPreload()` instead
- **Translation cache**: keyed by videoId + lines_hash — changing lyrics source invalidates cache automatically
- **yt-dlp version**: must be kept updated, older versions can't extract data
- **playNow filter**: after removing duplicates from playlist, must re-locate currentIndex
- **Cached playback**: must set currentVideoIdRef + call audio.play() (both were missing before)
- **SponsorBlock + streaming**: must check buffer range before seeking (prevents infinite loop)
- **Background Blob switch**: must download immediately, not wait for backend cache (causes lock-screen silence)
- **Video download**: yt-dlp adds .mp4 extension automatically — temp path must account for this
- **Search**: must NOT replace playlist (causes auto-play), only update searchResults
- **autoQueue dependencies**: must include currentIndex + playlist.length but use composite key to prevent loops
- **Video mode audio**: NEVER pause/mute audio element in video mode — iframe/video must be muted instead, audio element is the only sound source
- **Video sync**: cached `<video>` element syncs via `onCanPlay` (once) + interval (drift >3s) — too frequent = buffering spinner
- **iframe onStateChange**: must NOT dispatch `setIsPlaying` — iframe pause/destroy would stop audio; only sync position + force play
- **Tail silence**: use `track.duration` (YouTube metadata) everywhere, not `audio.duration` (which includes encoded silence)
- **Restore playback**: use `audioCacheService.getMetadata()` for instant track info — `getVideoInfo` (yt-dlp) takes 10s+
- **Auto-queue timing**: must wait for metadata (channel non-empty) — placeholder track causes empty-artist recommendations
- **playNow cleanup**: must clear tracks after insert position — otherwise old recommendations from previous artist remain
- **Preload filter**: skip tracks >600s duration — compilation albums waste IndexedDB space (60-114MB each)
- **Radio track sync**: Host must emit `pendingTrack || currentTrack` (not just currentTrack) — otherwise Listener sees delayed update
- **Lyrics sync loop**: remote offset/source apply MUST set `isRemoteUpdateRef = true` before dispatch — prevents infinite emit→receive→emit loop
- **Crossfade + SponsorBlock**: must pause skip segment checks during crossfade, resume on new primary element
- **Crossfade warm-up**: secondary audio element must be warmed up on first user interaction — otherwise mobile autoplay policy blocks it
- **Crossfade interruption**: DJ skip during crossfade must immediately cancel and hard-switch — don't let stale crossfade timer complete
- **Lyrics drag dismiss**: `touchAction: 'none'` on header is essential — without it, browser scroll intercepts the swipe gesture
- **Lyrics drag + transition**: `isDraggingRef` disables CSS transition during active drag — otherwise translateY lags behind finger
- **Sticky search zIndex**: must be lower than MUI Drawer/Modal (1300) but above content — zIndex 5 is correct
