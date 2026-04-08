## ADDED Requirements

### Requirement: Track cards MUST support full-area playback
Search result cards and recommendation cards SHALL make the primary card surface clickable so users can start playback without targeting a small icon.

#### Scenario: Tapping the card body
- **WHEN** the user taps the artwork, title, or other non-button area of a track card
- **THEN** the app starts playback for that track

### Requirement: Track card utility buttons MUST isolate click events
Secondary actions inside a clickable track card SHALL stop event propagation so they do not accidentally trigger playback.

#### Scenario: Opening add-to-playlist without playback
- **WHEN** the user taps a nested utility button such as add-to-queue or add-to-playlist
- **THEN** the requested utility action runs
- **AND** the track does not start playing unless that button explicitly requests playback

### Requirement: Clickable track cards SHALL provide visible feedback
Clickable track cards SHALL preserve Material UI interaction feedback so the tap target feels intentional and responsive.

#### Scenario: Pressing a track card
- **WHEN** the user presses a clickable track card
- **THEN** the UI shows the configured ripple, hover, or pressed-state feedback for that card
