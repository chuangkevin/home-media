## Why

The home-media streaming application has four critical bugs and one major performance issue that degrade the user experience: audio cache files are corrupted with silent second halves, uncached tracks fail to play on first attempt, lyrics search returns wrong results due to faulty title parsing, lyrics scrolling lags behind the music, and search takes 5-30 seconds due to using yt-dlp for search instead of the faster youtube-sr library. These issues affect daily usage and need immediate resolution.

## What Changes

- Fix audio cache write pipeline to handle Node.js stream backpressure, preventing corrupted/truncated cache files
- Improve uncached track playback reliability by deferring background operations and adding proper error recovery
- Rewrite lyrics title extraction regex to correctly parse "Artist - Song Title" format and multi-dash titles
- Replace smooth scroll + timeupdate-based lyrics sync with requestAnimationFrame for precise, low-latency scrolling
- Switch search from yt-dlp (5-30s) to youtube-sr (<3s), extend cache TTL to 24h, limit precache to 3 tracks, remove frontend preload on search

## Capabilities

### New Capabilities
- `audio-cache-integrity`: Proper stream backpressure handling, atomic file writes, and cache validation to prevent corrupted audio files
- `playback-reliability`: Robust playback flow for uncached tracks with error recovery, retry logic, and deferred background operations
- `lyrics-search-accuracy`: Improved title/artist extraction from YouTube video titles for accurate lyrics search across LRCLIB, NetEase, and Genius
- `lyrics-scroll-precision`: High-precision lyrics synchronization using requestAnimationFrame with minimal visual lag
- `search-performance`: Fast search using youtube-sr, extended cache TTL, reduced precache scope, no frontend preload on search

### Modified Capabilities
<!-- No existing specs to modify -->

## Impact

- **Backend**: `youtube.controller.ts` (stream handler, precache limit), `audio-cache.service.ts` (download pipeline), `lyrics.service.ts` (title parsing), `youtube.service.ts` (search engine switch)
- **Frontend**: `AudioPlayer.tsx` (playback flow, error recovery), `LyricsView.tsx` (scroll sync logic)
- **APIs**: No API contract changes; internal implementation only
- **Dependencies**: No new dependencies required
- **Risk**: Cache pipeline changes require careful testing to avoid data loss; playback flow changes affect all devices
