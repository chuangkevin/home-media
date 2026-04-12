## ADDED Requirements

### Requirement: Similar track scoring MUST use style vectors when available
When both the seed track and candidate track have style data in `track_styles`, the similarity score SHALL be calculated as: 40% mood+energy match, 30% genre match, 20% theme overlap, 10% same channel bonus.

#### Scenario: Two tracks with matching mood and genre
- **WHEN** seed track has mood "chill", energy "low", genre "indie-rock" and candidate has mood "chill", energy "low", genre "indie-rock"
- **THEN** similarity score is >= 0.9

#### Scenario: Two tracks with adjacent moods
- **WHEN** seed track has mood "chill" and candidate has mood "dreamy"
- **THEN** mood component scores 0.5 (adjacency match) instead of 0 (no match)

#### Scenario: Cross-genre recommendation via mood
- **WHEN** seed track is chill indie-rock and candidate is chill jazz
- **THEN** similarity score is >= 0.5 (mood matches, genre differs)

#### Scenario: One track lacks style data
- **WHEN** seed track has style data but candidate does not
- **THEN** the system falls back to existing tag/title similarity scoring

### Requirement: Mood adjacency MUST follow defined matrix
The system SHALL use a mood adjacency matrix where adjacent moods score 0.5: energetic↔upbeat, chill↔dreamy, melancholic↔dark, romantic↔dreamy, aggressive↔energetic. Non-adjacent moods score 0.

#### Scenario: Energy adjacency
- **WHEN** seed track has energy "medium" and candidate has energy "high"
- **THEN** energy component scores 0.5 (one level apart)

#### Scenario: Energy far apart
- **WHEN** seed track has energy "very-low" and candidate has energy "very-high"
- **THEN** energy component scores 0 (more than one level apart)

### Requirement: Recommendation reasons MUST be returned with each result
Each recommended track SHALL include a human-readable `reason` string explaining why it was recommended.

#### Scenario: Style-based recommendation
- **WHEN** a track is recommended based on style matching
- **THEN** the reason includes the matching attributes, e.g., "Similar mood: chill indie-rock"

#### Scenario: Fallback recommendation
- **WHEN** a track is recommended via tag matching (no style data)
- **THEN** the reason indicates fallback, e.g., "Similar tags: indie, rock"

### Requirement: Recommendation startup SHALL tolerate legacy history storage
首頁推薦 SHALL continue working when `watched_channels` is empty but playable history still exists in `cached_tracks`.

#### Scenario: Legacy history fallback
- **WHEN** `watched_channels` has no rows but `cached_tracks` has rows with `last_played > 0` and `channel_name`
- **THEN** the recommendation service SHALL derive seed channels from `cached_tracks` instead of returning an empty recommendation set

#### Scenario: Empty mixed cache must not stick
- **WHEN** the cached first-page mixed recommendation payload contains zero recommendations
- **THEN** the controller SHALL bypass that cache entry and regenerate recommendations instead of returning the empty cached response for up to 5 minutes
