## Why

The home-media streaming application has four critical bugs that degrade the user experience: audio cache files are corrupted with silent second halves, uncached tracks fail to play on first attempt, lyrics search returns wrong results due to faulty title parsing, and lyrics scrolling lags behind the music. These issues affect daily usage and need immediate resolution.

## What Changes

- Fix audio cache write pipeline to handle Node.js stream backpressure, preventing corrupted/truncated cache files
- Improve uncached track playback reliability by deferring background operations and adding proper error recovery
- Rewrite lyrics title extraction regex to correctly parse "Artist - Song Title" format and multi-dash titles
- Replace smooth scroll + timeupdate-based lyrics sync with requestAnimationFrame for precise, low-latency scrolling

## Capabilities

### New Capabilities
- `audio-cache-integrity`: Proper stream backpressure handling, atomic file writes, and cache validation to prevent corrupted audio files
- `playback-reliability`: Robust playback flow for uncached tracks with error recovery, retry logic, and deferred background operations
- `lyrics-search-accuracy`: Improved title/artist extraction from YouTube video titles for accurate lyrics search across LRCLIB, NetEase, and Genius
- `lyrics-scroll-precision`: High-precision lyrics synchronization using requestAnimationFrame with minimal visual lag

### Modified Capabilities
<!-- No existing specs to modify -->

## Impact

- **Backend**: `youtube.controller.ts` (stream handler), `audio-cache.service.ts` (download pipeline), `lyrics.service.ts` (title parsing)
- **Frontend**: `AudioPlayer.tsx` (playback flow, error recovery), `LyricsView.tsx` (scroll sync logic)
- **APIs**: No API contract changes; internal implementation only
- **Dependencies**: No new dependencies required
- **Risk**: Cache pipeline changes require careful testing to avoid data loss; playback flow changes affect all devices
