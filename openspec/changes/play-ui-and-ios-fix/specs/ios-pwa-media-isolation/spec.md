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
