## ADDED Requirements

### Requirement: Stream-to-cache writes MUST handle backpressure
The audio cache write pipeline SHALL use Node.js `pipeline()` or `pipe()` to write yt-dlp stdout to cache files. The system MUST NOT use manual `writeStream.write(chunk)` without checking the return value and pausing the source stream on `false`.

#### Scenario: Large audio file download with slow disk
- **WHEN** yt-dlp outputs audio data faster than the disk can write
- **THEN** the source stream is paused until the write buffer drains, and no data is lost

#### Scenario: Normal audio file download
- **WHEN** yt-dlp outputs a standard 4-minute audio track
- **THEN** the cache file contains the complete audio data matching the stream output byte-for-byte

### Requirement: Cache file finalization MUST be atomic
The system SHALL wait for the writeStream `finish` event before renaming the `.tmp` file to the final cache path. The system MUST NOT rename files in the `stdout.end` or `close` event handlers.

#### Scenario: Stream completes normally
- **WHEN** yt-dlp stdout ends and all data is flushed to disk
- **THEN** the `.tmp` file is renamed to the final cache path only after `finish` event fires

#### Scenario: Stream interrupted mid-download
- **WHEN** yt-dlp process exits with non-zero code during download
- **THEN** the `.tmp` file is deleted and no corrupted cache file is left behind

#### Scenario: Client disconnects during streaming
- **WHEN** the HTTP client disconnects while stream-to-cache is in progress
- **THEN** the yt-dlp process continues to completion and the cache file is finalized correctly

### Requirement: Simultaneous stream-and-cache MUST not corrupt either output
When streaming to HTTP response and cache file simultaneously, the system SHALL ensure both outputs receive identical, complete data. If either output fails, the other MUST continue unaffected.

#### Scenario: HTTP response slow, cache write fast
- **WHEN** the HTTP client is slow to consume data but the disk write is fast
- **THEN** both the HTTP response and cache file contain the complete audio data

#### Scenario: Cache write fails mid-stream
- **WHEN** the cache writeStream encounters a disk error during streaming
- **THEN** the HTTP response continues streaming uninterrupted and the `.tmp` file is cleaned up

### Requirement: Remux MUST only start after cache file is fully written
The `remuxIfNeeded()` call SHALL only execute after confirming the cache file exists and the writeStream has emitted `finish`.

#### Scenario: DASH m4a needs remuxing
- **WHEN** a DASH m4a file is fully cached and the finish event has fired
- **THEN** ffmpeg remux starts and produces a valid playable m4a file
