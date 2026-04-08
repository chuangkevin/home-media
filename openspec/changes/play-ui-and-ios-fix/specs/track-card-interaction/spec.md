## ADDED Requirements

### Requirement: Track cards MUST support full-area playback
Search results and recommendation track cards SHALL allow playback from the primary card surface rather than only a small play icon.

#### Scenario: Tapping the card body
- **WHEN** the user taps the artwork, title, or other primary area of a track card
- **THEN** the app starts playback for that track

### Requirement: Track card utility buttons MUST isolate click events
Secondary actions inside a clickable track card SHALL stop event propagation so they do not accidentally trigger playback.

#### Scenario: Opening add-to-playlist without playback
- **WHEN** the user taps a nested action such as add-to-queue or add-to-playlist
- **THEN** the requested action runs
- **AND** playback does not start unless that specific action explicitly requests it

### Requirement: Clickable track cards SHALL provide visible feedback
Clickable track cards SHALL preserve visible interaction feedback.

#### Scenario: Pressing a clickable track card
- **WHEN** the user presses a clickable track card
- **THEN** the UI shows the configured ripple, hover, or pressed-state feedback for that card
