## ADDED Requirements

### Requirement: Lyrics line detection MUST use requestAnimationFrame
The lyrics synchronization loop SHALL use `requestAnimationFrame` to read `audio.currentTime` directly from the audio element at ~60Hz, instead of relying on Redux state updates from `timeupdate` events.

#### Scenario: Normal playback with synced lyrics
- **WHEN** a track with synced lyrics is playing
- **THEN** the current lyrics line updates within 1 frame (16ms) of crossing a timestamp boundary

#### Scenario: Lyrics not visible
- **WHEN** the lyrics container is not visible (drawer closed)
- **THEN** the requestAnimationFrame loop is stopped to save resources

#### Scenario: Tab is hidden
- **WHEN** the browser tab is not visible (document.hidden is true)
- **THEN** the requestAnimationFrame loop is paused

### Requirement: Lyrics scroll MUST NOT use smooth behavior
The lyrics auto-scroll SHALL use CSS `transform` with a short CSS `transition` (150ms ease-out) instead of `scrollTo({ behavior: 'smooth' })` which introduces 100-500ms delay.

#### Scenario: Line changes during playback
- **WHEN** the current lyrics line changes
- **THEN** the scroll animation completes within 150ms

#### Scenario: Rapid line changes
- **WHEN** multiple line changes happen within 200ms (e.g., fast-spoken lyrics)
- **THEN** each scroll update cancels the previous animation and jumps to the latest position

### Requirement: Time offset adjustment MUST be reflected immediately
When the user adjusts the lyrics time offset, the change SHALL take effect on the next animation frame without waiting for a Redux dispatch cycle.

#### Scenario: User increases time offset by 0.5s
- **WHEN** the user taps the +0.5s offset button during playback
- **THEN** the highlighted lyrics line shifts within 16ms on the next frame

### Requirement: Lyrics scroll position MUST center the active line
The active lyrics line SHALL be scrolled to the vertical center of the lyrics container, not just scrolled into view.

#### Scenario: Active line near top of lyrics
- **WHEN** the first few lines of lyrics are active
- **THEN** the container scrolls to position the active line at vertical center (with top padding if needed)

#### Scenario: Active line near bottom of lyrics
- **WHEN** the last few lines of lyrics are active
- **THEN** the container scrolls as close to center as possible without overscrolling
