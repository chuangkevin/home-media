## ADDED Requirements

### Requirement: Search results MUST use more columns on wide screens
The search results grid SHALL use responsive breakpoints: xs=12 (1 col), sm=6 (2 col), md=4 (3 col), lg=3 (4 col).

#### Scenario: Desktop 1920px wide
- **WHEN** viewport width is 1920px
- **THEN** search results display in 4 columns

#### Scenario: Mobile 375px wide
- **WHEN** viewport width is 375px
- **THEN** search results display in 1 column

### Requirement: Recommendation cards MUST scale with viewport
ChannelSection cards SHALL use responsive minWidth instead of fixed 280px.

#### Scenario: Wide desktop
- **WHEN** viewport width is 1920px
- **THEN** recommendation cards are wider to fill available space

#### Scenario: Mobile
- **WHEN** viewport width is < 600px
- **THEN** recommendation cards are 240px minimum width

### Requirement: Admin settings MUST utilize desktop width
The admin settings page SHALL increase maxWidth from 1200px on xl screens.

#### Scenario: Desktop 1920px
- **WHEN** viewport width is 1920px
- **THEN** admin settings page uses up to 1600px width
