## ADDED Requirements

### Requirement: System MUST track skip and complete events
The `cached_tracks` table SHALL have `skip_count` and `complete_count` integer columns. The frontend SHALL emit events to increment these counters.

#### Scenario: User listens past 90% of track duration
- **WHEN** the audio `ended` event fires OR `currentTime >= duration * 0.9`
- **THEN** `complete_count` is incremented by 1 for that track

#### Scenario: User skips before 50% of track duration
- **WHEN** the user clicks next or selects another track AND `currentTime < duration * 0.5`
- **THEN** `skip_count` is incremented by 1 for that track

#### Scenario: User pauses and resumes
- **WHEN** the user pauses playback and later resumes the same track
- **THEN** neither skip nor complete is recorded until a definitive action occurs

### Requirement: Skip/complete ratio MUST influence recommendation scoring
Tracks with high skip ratios (skip_count / (skip_count + complete_count) > 0.7) SHALL receive a penalty of -0.3 in similarity scoring. Tracks with high complete ratios (> 0.8) SHALL receive a bonus of +0.1.

#### Scenario: Frequently skipped track appears as candidate
- **WHEN** a candidate track has 10 skips and 2 completes (skip ratio = 0.83)
- **THEN** its similarity score is reduced by 0.3

#### Scenario: Frequently completed track appears as candidate
- **WHEN** a candidate track has 2 skips and 15 completes (complete ratio = 0.88)
- **THEN** its similarity score is increased by 0.1

### Requirement: Backend API for recording playback signals
The system SHALL expose `POST /api/tracks/:videoId/signal` accepting `{type: "skip" | "complete"}` to record playback events.

#### Scenario: Record a skip event
- **WHEN** POST `/api/tracks/abc123/signal` with `{type: "skip"}`
- **THEN** `skip_count` for video `abc123` is incremented and 200 OK is returned

#### Scenario: Record a complete event
- **WHEN** POST `/api/tracks/abc123/signal` with `{type: "complete"}`
- **THEN** `complete_count` for video `abc123` is incremented and 200 OK is returned
