## ADDED Requirements

### Requirement: Search MUST use youtube-sr instead of yt-dlp
The search endpoint SHALL use the `youtube-sr` library (already installed, `^4.3.11`) for YouTube search queries instead of spawning a `yt-dlp` process. `yt-dlp` SHALL only be used for audio streaming and metadata extraction, NOT for search.

#### Scenario: User searches for a song
- **WHEN** a user submits a search query "周杰倫 告白氣球"
- **THEN** the search results are returned within 3 seconds (vs. 5-30 seconds with yt-dlp)

#### Scenario: youtube-sr returns results
- **WHEN** youtube-sr successfully completes a search
- **THEN** results contain videoId, title, channel, duration, and thumbnail matching the existing `YouTubeSearchResult` type

#### Scenario: youtube-sr fails
- **WHEN** youtube-sr throws an error (e.g., network issue)
- **THEN** the system falls back to yt-dlp search as a backup and logs a warning

### Requirement: Search cache TTL MUST be extended to 24 hours
The search result cache TTL SHALL be 24 hours (86,400,000 ms) instead of 1 hour (3,600,000 ms) to reduce redundant searches.

#### Scenario: Same query within 24 hours
- **WHEN** a user searches for the same query within 24 hours
- **THEN** cached results are returned instantly from SQLite without any network call

#### Scenario: Cache expired after 24 hours
- **WHEN** a user searches for a query whose cache is older than 24 hours
- **THEN** a fresh search is performed via youtube-sr

### Requirement: Background precache MUST be limited to 3 tracks
After search results are returned, the background precache SHALL only download the first 3 uncached tracks (down from 20). Precaching MUST NOT interfere with user-initiated playback.

#### Scenario: Search returns 20 results
- **WHEN** search returns 20 results and none are cached
- **THEN** only the first 3 tracks are queued for sequential background precaching

#### Scenario: User plays a track while precaching is running
- **WHEN** a user clicks play while background precaching is active
- **THEN** the user's playback stream takes priority and precaching pauses until playback stream completes

### Requirement: Frontend MUST NOT trigger preloadAudio after search
The frontend SHALL NOT call `preloadAudio()` or `fetchAndCache()` from the search handler (`handleSearch`). Pre-caching SHALL only happen server-side.

#### Scenario: Search results displayed
- **WHEN** search results are rendered in the UI
- **THEN** no frontend preload API calls are made (no `/api/preload/:videoId` requests)

#### Scenario: User clicks play on a search result
- **WHEN** the user explicitly clicks play on a track
- **THEN** the existing AudioPlayer playback flow handles streaming and caching
