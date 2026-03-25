## ADDED Requirements

### Requirement: System MUST analyze track style via Gemini
The system SHALL use Gemini 2.5 Flash to analyze each track's style, returning a structured JSON with mood, genre, subgenre, energy, language, and themes. The prompt MUST constrain mood to one of: energetic, chill, melancholic, upbeat, dark, dreamy, aggressive, romantic. Energy MUST be one of: very-low, low, medium, high, very-high.

#### Scenario: Analyze a Japanese indie rock track
- **WHEN** analyzing track with title "羊文学 – Feel", channel "羊文学", tags ["J-Rock", "indie"]
- **THEN** returns `{mood: "energetic", genre: "indie-rock", subgenre: "shoegaze", energy: "high", language: "ja", themes: ["youth", "energy"]}`

#### Scenario: Analyze a Chinese pop ballad
- **WHEN** analyzing track with title "周杰倫 - 告白氣球", channel "周杰倫", tags ["C-Pop"]
- **THEN** returns `{mood: "romantic", genre: "pop", subgenre: "mandopop", energy: "medium", language: "zh", themes: ["love", "confession"]}`

#### Scenario: Gemini returns invalid JSON
- **WHEN** Gemini response cannot be parsed as valid JSON
- **THEN** the system returns null and logs a warning without crashing

### Requirement: Style analysis results MUST be cached permanently
The system SHALL store style analysis results in a `track_styles` table with `video_id` as primary key. Once analyzed, a track MUST NOT be re-analyzed unless explicitly triggered.

#### Scenario: Track already analyzed
- **WHEN** style analysis is requested for a track that exists in `track_styles`
- **THEN** the cached result is returned immediately without calling Gemini

#### Scenario: First-time analysis
- **WHEN** style analysis is requested for a track not in `track_styles`
- **THEN** Gemini is called, and the result is stored in `track_styles`

### Requirement: Background batch analysis MUST respect rate limits
The system SHALL analyze uncached tracks in the background with a minimum 6-second interval between API calls (max 10 RPM). Analysis MUST NOT block user interactions.

#### Scenario: 20 search results, none analyzed
- **WHEN** search returns 20 results with no cached styles
- **THEN** background analysis starts sequentially, analyzing ~10 tracks per minute

#### Scenario: User plays track while analysis is running
- **WHEN** a user plays a track while batch analysis is in progress
- **THEN** the currently-playing track is prioritized for immediate analysis (skipping the queue)

### Requirement: Style analysis API endpoint
The system SHALL expose `POST /api/tracks/:videoId/style` to trigger analysis for a specific track and return the result.

#### Scenario: Trigger analysis via API
- **WHEN** POST request is made to `/api/tracks/dQw4w9WgXcQ/style`
- **THEN** the track is analyzed (or cache returned) and the style JSON is returned
