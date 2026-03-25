## ADDED Requirements

### Requirement: Player MUST use compact mode on short viewports
When viewport height is <= 768px, the player bar SHALL use a compact layout reducing height from ~180px to ~120px.

#### Scenario: Mobile phone in portrait
- **WHEN** viewport height is 667px (iPhone SE)
- **THEN** player uses compact mode: no thumbnail, single-line title, smaller icons

#### Scenario: Tablet 1920x720
- **WHEN** viewport height is 720px
- **THEN** player uses compact mode

#### Scenario: Desktop 1920x1080
- **WHEN** viewport height is 1080px
- **THEN** player uses full mode with thumbnail and all controls

### Requirement: Play button MUST remain large in compact mode
Even in compact mode, the play/pause button SHALL remain at least 48px for touch accessibility.

#### Scenario: Compact mode touch target
- **WHEN** player is in compact mode
- **THEN** play/pause button is 48px or larger, other controls are 32px
