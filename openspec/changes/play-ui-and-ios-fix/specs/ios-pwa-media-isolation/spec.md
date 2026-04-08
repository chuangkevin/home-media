## ADDED Requirements

### Requirement: PWA identity MUST remain unique on iOS
The Home Media PWA SHALL declare a unique manifest identity so iOS can distinguish it from other same-origin PWAs during media handoff and app restore.

#### Scenario: Installing multiple same-origin PWAs
- **WHEN** the user installs Home Media alongside another `.sisihome.org` PWA
- **THEN** Home Media exposes its own manifest `id`
- **AND** iOS can treat it as a distinct installed app

### Requirement: MediaSession ownership MUST be reasserted on active playback
The player SHALL reassert MediaSession ownership whenever playback becomes active or the app returns to the foreground, including embedded playback flows.

#### Scenario: Returning to foreground during playback
- **WHEN** Home Media becomes visible again while audio is already playing
- **THEN** the app refreshes MediaSession metadata and playback state
- **AND** the active playback remains associated with Home Media instead of a sibling PWA

### Requirement: iPhone standalone playback SHALL avoid hard end-of-track cuts
In iPhone standalone PWA mode, local playback SHALL avoid relying on a last-moment hard switch that replaces `audio.src` exactly at track end.

#### Scenario: Tail-end handoff on iPhone PWA
- **WHEN** an iPhone user starts playback in standalone PWA mode with a local playlist
- **AND** the current track is approaching its final seconds
- **THEN** the app preloads the next track before the current one ends
- **AND** it hands off playback through the shared audio pipeline without a hard end-of-track cut

#### Scenario: Radio sessions keep their own transport model
- **WHEN** the user is acting as a radio host or radio listener
- **THEN** the local iPhone PWA fallback does not override the radio playback flow

#### Scenario: Foreground track start stays on the primary audio path
- **WHEN** the user taps a track and the normal foreground `pendingTrack` load is in progress
- **THEN** the app does not switch that same interaction onto an alternate playback pipeline mid-load
- **AND** the primary shared audio element remains the only active audio source during startup

### Requirement: iPhone video resume MUST use a single recovery path
iPhone PWA video mode SHALL avoid running competing resume strategies that repeatedly change display mode and independently resync the visible video layer.

#### Scenario: Returning from background in video mode
- **WHEN** the app returns to the foreground while video mode is active
- **THEN** the visible video layer performs a single recovery sync against the audio authority
- **AND** the app does not oscillate between video and visualizer modes during recovery
