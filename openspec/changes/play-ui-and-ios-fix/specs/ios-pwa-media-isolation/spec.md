## ADDED Requirements

### Requirement: PWA identity MUST remain unique on iOS
Home Media SHALL declare a unique PWA identity so iOS can distinguish it from other same-origin PWAs during media handoff and app restore.

#### Scenario: Installing multiple same-origin PWAs
- **WHEN** the user installs Home Media alongside another `.sisihome.org` PWA
- **THEN** Home Media exposes its own manifest `id`
- **AND** iOS can treat it as a distinct installed app

### Requirement: MediaSession ownership MUST be reasserted on active playback
The player SHALL reassert MediaSession ownership whenever playback becomes active or the app returns to the foreground.

#### Scenario: Returning to foreground during playback
- **WHEN** Home Media becomes visible again while audio is already playing
- **THEN** the app refreshes MediaSession metadata and playback state
- **AND** the active playback remains associated with Home Media instead of a sibling PWA

### Requirement: Resume assertions MUST favor the active Home Media session
When iOS lock-screen media controls reopen the app, Home Media SHALL reassert the currently playing session.

#### Scenario: Reopening from lock screen media controls
- **WHEN** the user taps the lock-screen media controls to return to the app
- **THEN** Home Media updates MediaSession state for the active playback session
- **AND** iOS can resolve the playback ownership back to Home Media

### Requirement: iPhone PWA layout MUST honor Dynamic Island safe area
Home Media SHALL position its top-level iPhone PWA layout and fullscreen lyrics header below the active top safe area.

#### Scenario: Opening fullscreen lyrics on iPhone portrait
- **WHEN** the user opens fullscreen lyrics on iPhone portrait PWA
- **THEN** the drawer container does not add duplicate top safe-area padding
- **AND** the sticky header applies the required top inset once
- **AND** controls do not visually collide with the Dynamic Island area

### Requirement: Viewport-dependent heights MUST refresh after page restore
Home Media SHALL recompute viewport-dependent heights after iPhone PWA returns from lock screen or page restore.

#### Scenario: Returning from lock screen with lyrics drawer open
- **WHEN** the user unlocks iPhone and returns to Home Media with fullscreen lyrics open
- **THEN** the app recalculates the viewport height from the current visual viewport
- **AND** layout sections using viewport height render within the visible screen bounds

### Requirement: Background playback handoff MUST avoid fake-playing audio on iPhone PWA
When iPhone standalone PWA transitions to background during active playback, Home Media SHALL hand off playback to a background-safe transport rather than relying only on foreground `timeupdate`, `ended`, or timer callbacks.

#### Scenario: Lock screen playback after multiple tracks
- **WHEN** Home Media is already playing on iPhone standalone PWA and the page becomes hidden
- **THEN** the app hands off the current track, remaining playlist, and current playback position to continuous stream mode
- **AND** lock-screen playback continuity does not depend solely on local foreground timers continuing to run

#### Scenario: Same-track handoff does not reset visible playback state
- **WHEN** the current track is handed off to continuous stream while the same song is still playing
- **THEN** Home Media keeps the same visible current track in the UI
- **AND** it does not reset playback by treating that same track as a new pending track
