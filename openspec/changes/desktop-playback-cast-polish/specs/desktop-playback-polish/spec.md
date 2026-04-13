## ADDED Requirements

### Requirement: Desktop browsing MUST avoid horizontal-scroll-only interactions
On pointer-fine desktop layouts, homepage content SHALL remain operable without requiring horizontal scrolling gestures.

#### Scenario: Desktop user browses homepage sections with a mouse
- **WHEN** the viewport is desktop-sized and the pointer is fine
- **THEN** recommendation and personalized sections expose visible items in a wrapped/grid-like layout that can be operated with normal vertical scrolling and clicks
- **AND** mobile/tablet touch layouts may keep horizontal swipe behavior unchanged

### Requirement: Desktop personalized sections MUST show larger history/favorite sets
Desktop homepage personalization SHALL expose more items for recently played and favorites than the default mobile view.

#### Scenario: Desktop opens recently played and favorites
- **WHEN** the user is on a desktop layout
- **THEN** recently played and favorites show up to 20 items
- **AND** other homepage sections show up to 10 items before redirecting users to search/channel drill-down

### Requirement: Embedded side player MUST expose favorite action
When the fullscreen lyrics layout shows the left embedded player, that player SHALL include the same favorite toggle affordance as the main mini player.

#### Scenario: Landscape desktop fullscreen drawer
- **WHEN** the embedded left player is visible
- **THEN** the user can add/remove the current track from favorites without leaving the drawer

### Requirement: Video-mode seek MUST drive the single audio source
All seek interactions in video mode SHALL move the audio element first, and every visual layer SHALL follow that position.

#### Scenario: User drags the progress bar while video mode is active
- **WHEN** seek is committed in video mode
- **THEN** the audio element currentTime updates to the requested position
- **AND** YouTube iframe or cached video synchronizes to that same time

### Requirement: LRCLIB non-synced results MUST fall back to NetEase
If LRCLIB cannot provide synchronized lyrics for the requested track or the saved LRCLIB preference resolves to non-synced lyrics, the system SHALL continue to NetEase before concluding that only unsynced/no lyrics are available.

#### Scenario: Saved LRCLIB preference returns unsynced lyrics
- **WHEN** the player loads lyrics using a stored LRCLIB preference
- **THEN** it does not stop at that unsynced LRCLIB payload
- **AND** it attempts NetEase lookup before surfacing a no-synced-lyrics outcome

### Requirement: Video mode MUST render only one active lyrics overlay
Video mode SHALL not duplicate lyric text by rendering multiple overlapping overlays for the same current line.

#### Scenario: Cached video playback in video mode
- **WHEN** the current line is displayed over video
- **THEN** only one visual lyrics layer is shown for that line

### Requirement: Immersive mode default MUST be focus and persist override
The immersive lyrics effect SHALL default to `focus`, but once the user selects another effect the app SHALL remember it in localStorage.

#### Scenario: First-time immersive mode use
- **WHEN** no saved immersive effect exists
- **THEN** the active effect defaults to `focus`

#### Scenario: Returning user with saved immersive effect
- **WHEN** a saved effect exists in localStorage
- **THEN** immersive mode restores that saved effect instead of resetting to the default

### Requirement: Casting MUST be fire-and-forget
Starting a cast session SHALL send an initial playback payload to the receiver, after which the receiver plays independently from the sender's subsequent state changes.

#### Scenario: Sender changes playback after casting started
- **WHEN** a cast session has already started and the sender pauses, seeks, or skips locally
- **THEN** the receiver does not mirror those later commands automatically
- **AND** the receiver keeps playing from the initial cast payload unless it is explicitly stopped locally or the cast session is ended
