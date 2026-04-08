## ADDED Requirements

### Requirement: Z-index stacking MUST follow defined hierarchy
AudioPlayer SHALL use z-index 1100, BottomNavigation SHALL use z-index 1200, Lyrics Drawer SHALL use z-index 1300+.

#### Scenario: Player controls visible above content
- **WHEN** the player bar and navigation bar are both visible
- **THEN** the navigation bar renders above the player bar, and both render above page content

#### Scenario: Lyrics drawer covers player and nav
- **WHEN** the lyrics drawer is open
- **THEN** it renders above both the player bar and navigation bar

### Requirement: Bottom spacing MUST be dynamic
The main content container SHALL use dynamic bottom padding based on actual player and nav heights, not a hardcoded 250px value.

#### Scenario: Mobile viewport
- **WHEN** viewport height is <= 768px
- **THEN** bottom padding is approximately 192px (compact player 120px + nav 56px + 16px gap)

#### Scenario: Desktop viewport
- **WHEN** viewport height is > 768px
- **THEN** bottom padding is approximately 212px (player 140px + nav 56px + 16px gap)

### Requirement: Fullscreen lyrics padding MUST adapt to viewport height
The top/bottom padding inside fullscreen lyrics SHALL use viewport-aware values instead of fixed 30vh.

#### Scenario: Short viewport (720px)
- **WHEN** viewport height is 720px
- **THEN** lyrics top/bottom padding is max(60px, 10vh) = 72px, not 216px

#### Scenario: Tall viewport (1080px)
- **WHEN** viewport height is 1080px
- **THEN** lyrics top/bottom padding is max(120px, 20vh) = 216px

### Requirement: LyricsView height MUST be responsive
The LyricsView container SHALL NOT use a fixed 500px height. It SHALL use a viewport-relative height.

#### Scenario: Mobile (667px viewport)
- **WHEN** viewport height is 667px
- **THEN** LyricsView height adapts to approximately 60vh or less

#### Scenario: Desktop (1080px viewport)
- **WHEN** viewport height is 1080px
- **THEN** LyricsView height is capped at 500px

### Requirement: iPhone lyrics header MUST honor top safe area once
The fullscreen lyrics drawer SHALL apply top safe-area spacing from a single header layer on iPhone portrait, and SHALL NOT duplicate the same inset on both the drawer container and the sticky header.

#### Scenario: iPhone portrait with Dynamic Island
- **WHEN** fullscreen lyrics is opened on an iPhone portrait viewport
- **THEN** the top controls sit directly below the safe area boundary
- **AND** the drawer does not reserve extra blank space above the header

### Requirement: Top status toasts MUST avoid the Dynamic Island area
Top-aligned playback feedback, including SponsorBlock skip toasts, SHALL offset using `safe-area-inset-top` on iPhone PWA viewports.

#### Scenario: SponsorBlock skip toast on iPhone PWA
- **WHEN** a top snackbar is shown while lyrics drawer is open on iPhone PWA
- **THEN** the toast is rendered below the Dynamic Island safe area
- **AND** it does not overlap the lyrics header controls
