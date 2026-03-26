## ADDED Requirements

### Requirement: MORROR mode MUST display only current, previous, and next lyrics lines
No scrolling list. Only 3 lines visible at any time.

#### Scenario: Song playing with synced lyrics
- **WHEN** viewMode is 'morror' and lyrics are synced
- **THEN** display previous line (small, faded), current line (large, karaoke fill), next line (medium, preview)

#### Scenario: First line of song
- **WHEN** currentLineIndex is 0
- **THEN** previous line area is empty, only current + next shown

#### Scenario: Last line of song
- **WHEN** currentLineIndex is the last line
- **THEN** next line area is empty, only previous + current shown

#### Scenario: Lyrics not synced
- **WHEN** lyrics have no timestamps (isSynced is false)
- **THEN** fallback to normal scrolling lyrics view (renderLyrics), not morror mode

### Requirement: Current line MUST have karaoke fill animation
The active line text fills from left to right with the accent color over the line's duration.

#### Scenario: Line with 5-second duration
- **WHEN** current line starts and next line is 5 seconds later
- **THEN** text fill animation runs for 5 seconds, completing at the next line's timestamp

#### Scenario: Last line with unknown duration
- **WHEN** current line is the last line (no next line timestamp)
- **THEN** use a default duration of 4 seconds for the fill animation

### Requirement: Lines MUST transition with fade animation
When the current line changes, lines animate smoothly.

#### Scenario: Line changes during playback
- **WHEN** currentLineIndex changes from N to N+1
- **THEN** old current fades up and shrinks, new current grows and starts fill, new next fades in from below
- **AND** transition duration is 0.5 seconds

### Requirement: Background MUST use blurred album art
The background shows the album thumbnail blurred with a dark overlay.

#### Scenario: Track has thumbnail
- **WHEN** track.thumbnail is available
- **THEN** background shows thumbnail with blur(40px), opacity 0.3, scale 1.2, plus rgba(0,0,0,0.6) overlay

#### Scenario: Track has no thumbnail
- **WHEN** track.thumbnail is empty or undefined
- **THEN** background is solid #111111

### Requirement: Accent color MUST be driven by mood or thumbnail
Priority: mood color > thumbnail dominant color > default blue.

#### Scenario: Track has mood analysis
- **WHEN** track_styles has mood data for this videoId
- **THEN** accent color matches mood (energetic=#ff4444, chill=#4488ff, etc.)

#### Scenario: No mood but has thumbnail
- **WHEN** no mood data but thumbnail exists
- **THEN** extract dominant color from thumbnail via canvas

#### Scenario: No mood and no thumbnail
- **WHEN** neither mood nor thumbnail available
- **THEN** use default accent color #4488ff

### Requirement: Mode toggle MUST include morror option
The ToggleButtonGroup in FullscreenLyrics must include a 'morror' option.

#### Scenario: User switches to morror mode
- **WHEN** user clicks the morror toggle button
- **THEN** viewMode changes to 'morror' and MorrorLyrics renders

#### Scenario: Morror mode with unsynced lyrics
- **WHEN** user selects morror mode but lyrics are not synced
- **THEN** show a message "此歌詞無時間戳，無法使用沉浸模式" and stay on normal lyrics
