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

### Requirement: iPhone standalone playback SHALL use continuous streaming for lock-screen autoplay
In iPhone standalone PWA mode, local playback SHALL switch to continuous streaming before background playback depends on client-side track transitions.

#### Scenario: Lock-screen playback across multiple songs
- **WHEN** an iPhone user starts playback in standalone PWA mode with a local playlist
- **THEN** the app enables continuous stream mode before later track changes rely on client-side `playNext()`
- **AND** lock-screen playback can continue across multiple tracks without reopening the app

#### Scenario: Radio sessions keep their own transport model
- **WHEN** the user is acting as a radio host or radio listener
- **THEN** the automatic continuous-stream fallback does not override the radio playback flow

### Requirement: iPhone video resume MUST use a single recovery path
iPhone PWA video mode SHALL avoid running competing resume strategies that repeatedly change display mode and independently resync the visible video layer.

#### Scenario: Returning from background in video mode
- **WHEN** the app returns to the foreground while video mode is active
- **THEN** the visible video layer performs a single recovery sync against the audio authority
- **AND** the app does not oscillate between video and visualizer modes during recovery
