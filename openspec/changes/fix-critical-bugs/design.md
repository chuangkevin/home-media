## Context

Home-media is a YouTube music streaming center deployed on Raspberry Pi. It uses yt-dlp to extract audio, streams it to browsers, and caches files server-side (10GB LRU) and client-side (IndexedDB). Four bugs and one major performance issue have been identified that affect daily usage across all devices.

**Current State:**
- Stream handler (`youtube.controller.ts:128-289`) manually writes chunks to both HTTP response and cache file without backpressure handling
- Cache download (`audio-cache.service.ts:693-809`) has the same manual write pattern
- Playback flow (`AudioPlayer.tsx`) was recently optimized (48dc50b) but still has reliability issues for uncached tracks
- Lyrics title parser (`lyrics.service.ts:612-667`) uses regex that fails on common "Artist - Song" formats
- Lyrics scroll (`LyricsView.tsx:87-139`) uses `smooth` scroll behavior causing 100-500ms visual lag
- Search (`youtube.service.ts:79-144`) uses yt-dlp `ytsearch20:` which spawns a process and takes 5-30 seconds; `youtube-sr` is installed but unused
- After search, backend precaches all 20 results sequentially (each spawning yt-dlp), and frontend fires `preloadAudio()` + `fetchAndCache()` adding more load

## Goals / Non-Goals

**Goals:**
- Eliminate audio cache corruption (blank second half)
- Make first-play of uncached tracks reliable without page refresh
- Correctly extract song titles from YouTube video titles for lyrics search
- Make lyrics scrolling visually precise and responsive
- Reduce search latency from 5-30s to <3s

**Non-Goals:**
- Redesigning the caching architecture (LRU strategy, size limits)
- Adding new lyrics sources
- Changing the yt-dlp integration pattern (spawn-based)
- Modifying the playlist or radio features

## Decisions

### D1: Use Node.js pipe() for stream-to-cache writes
**Choice:** Replace manual `stdout.on('data')` + `writeStream.write(chunk)` with `stream.pipe()` or proper backpressure handling via `pipeline()` from `stream/promises`.

**Why over manual write:** `pipe()` automatically handles backpressure - pauses the readable when writable buffer is full, resumes on drain. Manual chunk-by-chunk writing silently drops data when buffer overflows.

**Trade-off:** For the streaming endpoint, we still need to write to both `res` and `cacheStream`. We'll use a PassThrough stream that pipes yt-dlp stdout to both destinations, with proper backpressure on the cache side.

**Alternative considered:** Downloading to cache first, then serving from cache. Rejected because it adds latency for first play - user must wait for full download.

### D2: Atomic cache file finalization
**Choice:** Wait for `writeStream.on('finish')` event before renaming `.tmp` → final path. Currently rename happens in `stdout.on('end')` callback which fires before disk flush.

**Why:** The `finish` event guarantees all buffered data has been flushed to the underlying resource. `end` only means no more data will be written to the stream's internal buffer.

### D3: Defer fetchAndCache until audio.play() succeeds
**Choice:** Move frontend `fetchAndCache()` from 1-second-after-load to after `audio.play()` resolves successfully AND `timeupdate` fires at least once (confirming real playback).

**Why:** This ensures the streaming yt-dlp process has completed or is well underway before the frontend starts a second download request for caching.

### D4: Add exponential backoff retry for failed streams
**Choice:** When `audio.error` fires for uncached tracks, retry with exponential backoff (1s, 3s, 7s) up to 3 attempts before giving up.

**Why over single retry:** YouTube rate-limits yt-dlp; a single immediate retry often hits the same throttle. Exponential backoff gives YouTube's rate-limiter time to reset.

### D5: Two-pass title extraction with artist hint
**Choice:** Rewrite `cleanSongTitle()` to accept optional `channelName` parameter. Strategy:
1. First, try splitting on ` - ` (with spaces) to separate artist/title
2. If the part before `-` matches channel name (fuzzy), the part after `-` is the song title
3. If no match, return both parts joined as search query
4. Fall back to existing Chinese bracket extraction and suffix removal

**Why:** The current regex `/[-–—]\s*(.+?)$/` is non-greedy and doesn't use channel name as a disambiguation hint. The channel name is already available from the frontend.

### D6: requestAnimationFrame-based lyrics scroll
**Choice:** Replace `useEffect` + `smooth` scroll with a `requestAnimationFrame` loop that:
1. Reads `audio.currentTime` directly (not from Redux state with dispatch delay)
2. Computes target scroll position
3. Applies scroll with CSS `transition` on a transform instead of `scrollTo({behavior: 'smooth'})`

**Why over current approach:** `timeupdate` fires at 4-15Hz (browser-dependent). `requestAnimationFrame` fires at 60Hz, giving much smoother visual tracking. Direct `audio.currentTime` access avoids Redux dispatch → re-render → effect cycle latency.

### D7: Use youtube-sr for search, yt-dlp as fallback

**Choice:** Replace `youtubedl('ytsearch20:query', ...)` with `youtube-sr` library's `YouTube.search()` method. Keep yt-dlp as fallback if youtube-sr fails.

**Why:** `youtube-sr` is a pure HTTP scraper (no process spawn), returning results in 1-3 seconds vs. 5-30 seconds for yt-dlp. It's already installed (`^4.3.11`) but never used for search. yt-dlp is overkill for search — it's designed for downloading, not search.

**Alternative considered:** Using YouTube Data API v3. Rejected because it requires an API key, contradicting the project's zero-config philosophy.

### D8: Extend search cache TTL to 24 hours

**Choice:** Change `SEARCH_CACHE_TTL` from 1 hour to 24 hours.

**Why:** Search results rarely change within 24 hours. YouTube video metadata (title, channel, thumbnail) is stable. The 1-hour TTL was overly aggressive, causing unnecessary repeat searches.

### D9: Limit precache to 3 tracks and remove frontend preload on search

**Choice:** Reduce `precacheVideos()` call in search handler from all results to first 3. Remove `preloadAudio()` and `fetchAndCache()` calls from frontend `handleSearch()`.

**Why:** Precaching 20 tracks spawns 20 sequential yt-dlp processes (each 10-30s). Users typically only play 1-3 tracks from search results. Frontend preload duplicates the backend precache work.

## Risks / Trade-offs

- **[Risk] pipe() error handling complexity** → Mitigation: Use `pipeline()` from `stream/promises` which handles cleanup automatically on error
- **[Risk] Retry logic could cause multiple yt-dlp spawns** → Mitigation: Track in-flight streams per videoId, dedup requests
- **[Risk] rAF loop battery impact on mobile** → Mitigation: Only run when lyrics are visible; pause when tab is hidden via `document.hidden`
- **[Risk] Title extraction heuristic may fail on edge cases** → Mitigation: Log extraction results for monitoring; keep fallback to full title search
