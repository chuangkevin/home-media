## ADDED Requirements

### Requirement: Uncached track playback MUST succeed on first attempt
The system SHALL play uncached tracks without requiring a page refresh. The audio element MUST receive a valid stream from the backend on the first play request.

#### Scenario: User plays a never-cached track
- **WHEN** a user clicks play on a track that is not in browser cache or server cache
- **THEN** audio begins playing within 15 seconds without any user intervention

#### Scenario: User plays a server-cached but not browser-cached track
- **WHEN** a user clicks play on a track that exists in server cache but not IndexedDB
- **THEN** audio begins playing within 5 seconds without any user intervention

### Requirement: Frontend cache download MUST be deferred until playback is confirmed
The `fetchAndCache()` call SHALL NOT start until `audio.play()` resolves successfully AND at least one `timeupdate` event fires, confirming real audio playback.

#### Scenario: Uncached track starts playing
- **WHEN** audio begins playing and timeupdate fires
- **THEN** fetchAndCache starts downloading the track to IndexedDB in the background

#### Scenario: Audio fails to play
- **WHEN** audio.play() rejects or no timeupdate fires within 10 seconds
- **THEN** fetchAndCache is NOT triggered

### Requirement: Failed stream MUST retry with exponential backoff
When the audio stream fails for an uncached track, the system SHALL retry up to 3 times with exponential backoff (1s, 3s, 7s delays).

#### Scenario: First stream attempt fails with network error
- **WHEN** the audio element fires an error event on initial load
- **THEN** the system waits 1 second and retries with a fresh stream URL

#### Scenario: All retry attempts fail
- **WHEN** 3 retry attempts all fail
- **THEN** the system shows an error message to the user and stops retrying

#### Scenario: Retry succeeds on second attempt
- **WHEN** the first stream attempt fails but the second succeeds
- **THEN** audio plays normally and the retry counter resets

### Requirement: In-flight stream requests MUST be deduplicated
The system SHALL track in-flight yt-dlp processes per videoId. If a stream request arrives for a videoId that already has an active yt-dlp process, the system MUST NOT spawn a duplicate process.

#### Scenario: Rapid double-click on play button
- **WHEN** two stream requests arrive for the same videoId within 1 second
- **THEN** only one yt-dlp process is spawned and both requests share the result

### Requirement: Auto-next MUST work reliably on iOS background/lock screen
When a track finishes playing on iOS Safari with the screen locked, the system SHALL advance to the next track without multi-minute delays caused by throttled `timeupdate` events or audio tail silence.

#### Scenario: Track ends while iPhone screen is locked
- **WHEN** a track reaches its YouTube metadata duration while the page is in background
- **THEN** the next track begins within 60 seconds (setTimeout fallback fires even under iOS timer throttling)

#### Scenario: User unlocks phone after track ended in background
- **WHEN** the user returns to the app and `audio.currentTime >= trackDuration - 0.5`
- **THEN** `playNext()` is triggered immediately via `visibilitychange` handler

#### Scenario: Normal foreground playback (no regression)
- **WHEN** a track ends while the app is in foreground
- **THEN** the existing `timeupdate`-based end detection at `trackDuration - 0.5s` fires as before, and the setTimeout fallback is cleared to prevent double-trigger
