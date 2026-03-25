## ADDED Requirements

### Requirement: System MUST generate user preference profile from listening history
The system SHALL analyze the styles of the user's top 50 most-played tracks and aggregate them into a preference profile containing: preferred moods (weighted), preferred genres (weighted), preferred energy levels, preferred languages, and top themes.

#### Scenario: User has 50+ played tracks with style data
- **WHEN** profile generation is triggered and 50+ tracks have styles analyzed
- **THEN** a preference profile JSON is generated and cached in the settings table

#### Scenario: User has fewer than 10 analyzed tracks
- **WHEN** profile generation is triggered but fewer than 10 tracks have style data
- **THEN** the system returns null and does not generate a profile

### Requirement: Profile MUST be refreshed weekly or after significant listening
The cached profile SHALL be regenerated when: (a) it is older than 7 days, OR (b) 20+ new tracks have been played since the last generation.

#### Scenario: Profile is 8 days old
- **WHEN** the profile endpoint is called and the cached profile is 8 days old
- **THEN** a fresh profile is generated before returning

#### Scenario: Profile is 2 days old with 5 new plays
- **WHEN** the profile endpoint is called and only 5 new tracks were played
- **THEN** the cached profile is returned without regeneration

### Requirement: Profile endpoint MUST be accessible via API
The system SHALL expose `GET /api/recommendations/profile` returning the user preference profile.

#### Scenario: Profile exists
- **WHEN** GET request is made and a valid profile exists
- **THEN** the profile JSON is returned with preferredMoods, preferredGenres, preferredEnergy, preferredLanguages, topThemes, and generatedAt

#### Scenario: No profile yet
- **WHEN** GET request is made but no profile has been generated
- **THEN** the system attempts to generate one; if insufficient data, returns `{profile: null, reason: "insufficient_data"}`
