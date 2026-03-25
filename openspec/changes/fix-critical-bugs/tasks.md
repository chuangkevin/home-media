## 1. Audio Cache Integrity (P0)

- [x] 1.1 Refactor `streamWithYtDlp()` in `youtube.controller.ts` to use proper backpressure handling (pause/resume/drain) for cache writeStream
- [x] 1.2 Move cache file rename from `stdout.end` to `writeStream.finish` event to ensure atomic finalization
- [x] 1.3 Ensure remuxIfNeeded() only runs after finish event and file existence check
- [x] 1.4 Add cleanup logic: delete `.tmp` on error, process exit, and client disconnect
- [x] 1.5 Refactor `doDownloadWithYtDlp()` in `audio-cache.service.ts` with same backpressure fix
- [x] 1.6 Write unit tests for cache write pipeline (mock streams, verify backpressure behavior)
- [x] 1.7 Test: verify cached file byte-for-byte matches streamed output (no truncation)
- [x] 1.8 Update spec status, commit, push

## 2. Playback Reliability (P1)

- [x] 2.1 Move `fetchAndCache()` trigger from 1-second timeout to after `audio.play()` + first `timeupdate` event
- [x] 2.2 Add exponential backoff retry (1s, 3s, 7s) for failed audio stream loads in `AudioPlayer.tsx`
- [x] 2.3 Add in-flight stream deduplication per videoId in `youtube.controller.ts`
- [x] 2.4 Add user-visible error message after all retries fail
- [x] 2.5 Write unit tests for retry logic and deduplication
- [x] 2.6 Test: play uncached track, verify first-attempt success
- [x] 2.7 Update spec status, commit, push

## 3. Lyrics Search Accuracy (P2)

- [x] 3.1 Add `channelName` parameter to `cleanSongTitle()` in `lyrics.service.ts`
- [x] 3.2 Implement two-pass title extraction: first try artist-title split using channel name match, then fall back to existing regex
- [x] 3.3 Update `cleanArtistName()` to handle more suffix patterns
- [x] 3.4 Update all callers (`fetchNeteaseLyrics`, `fetchLRCLIB`, `fetchGeniusLyrics`) to pass cleaned artist and title separately
- [x] 3.5 Update frontend API calls to pass channel name alongside title
- [x] 3.6 Add debug logging for extraction results
- [x] 3.7 Write unit tests for title extraction with various formats ("Artist - Song", "Artist - Song - Remix", Chinese titles, no dash)
- [x] 3.8 Test: search lyrics for "Artist - Song" format videos, verify correct results
- [x] 3.9 Update spec status, commit, push

## 4. Lyrics Scroll Precision (P3)

- [x] 4.1 Create `useLyricsSync` hook using `requestAnimationFrame` to read `audio.currentTime` directly
- [x] 4.2 Add visibility check: pause rAF loop when lyrics not visible or tab hidden
- [x] 4.3 Replace `scrollTo({ behavior: 'smooth' })` with CSS transform + 150ms transition
- [x] 4.4 Ensure time offset changes take effect on next animation frame
- [x] 4.5 Maintain center-alignment logic for active line
- [x] 4.6 Write unit tests for the sync hook (mock audio element, verify line index calculation)
- [x] 4.7 Test: verify lyrics scroll matches audio timing precisely
- [x] 4.8 Update spec status, commit, push

## 5. Search Performance (P1)

- [x] 5.1 Replace yt-dlp search with youtube-sr in `youtube.service.ts` search method, keep yt-dlp as fallback
- [x] 5.2 Map youtube-sr result fields to existing `YouTubeSearchResult` type
- [x] 5.3 Extend `SEARCH_CACHE_TTL` from 1 hour to 24 hours
- [x] 5.4 Limit `precacheVideos()` in search handler to first 3 results instead of all
- [x] 5.5 Remove frontend `preloadAudio()` and `fetchAndCache()` calls from `handleSearch()` in `App.tsx`
- [x] 5.6 Write unit test: youtube-sr search returns valid results mapped to correct type
- [x] 5.7 Write unit test: fallback to yt-dlp when youtube-sr fails
- [x] 5.8 Test: measure search latency before/after (target <3s)
- [x] 5.9 Update spec status, commit, push

## 6. E2E Testing & Final Verification

- [ ] 6.1 Write e2e test: play uncached track → verify audio plays → verify cache file created intact
- [ ] 6.2 Write e2e test: search lyrics for "Artist - Song" format → verify correct lyrics returned
- [ ] 6.3 Write e2e test: play track with synced lyrics → verify scroll timing
- [ ] 6.4 Write e2e test: search returns results within 3 seconds
- [ ] 6.5 Final integration test across all fixes
- [ ] 6.6 Update all spec statuses, final commit, push
