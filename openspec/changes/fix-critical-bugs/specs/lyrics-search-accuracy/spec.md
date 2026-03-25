## ADDED Requirements

### Requirement: Title extraction MUST correctly parse "Artist - Song" format
The `cleanSongTitle()` method SHALL accept an optional `channelName` parameter. When the title contains a dash separator and the text before the dash matches the channel name (case-insensitive, fuzzy), the system MUST return the text after the dash as the song title.

#### Scenario: Standard "Artist - Song Title" format
- **WHEN** title is "Michael Jackson - Billie Jean" and channel is "Michael Jackson"
- **THEN** cleanSongTitle returns "Billie Jean"

#### Scenario: Artist name with suffix in channel
- **WHEN** title is "Adele - Hello" and channel is "Adele - Topic"
- **THEN** cleanSongTitle returns "Hello"

#### Scenario: Title with multiple dashes
- **WHEN** title is "The Weeknd - Save Your Tears - Remix" and channel is "The Weeknd"
- **THEN** cleanSongTitle returns "Save Your Tears - Remix" (only splits on first artist-matched dash)

#### Scenario: No channel name match
- **WHEN** title is "Best Pop Songs 2024 - Top Hits" and channel is "Music Compilation"
- **THEN** cleanSongTitle falls through to existing logic (does not blindly split on dash)

### Requirement: Channel name MUST be cleaned before comparison
The artist/channel comparison SHALL clean both the channel name and the pre-dash text by removing "- Topic", "VEVO", "Official", and common suffixes before fuzzy matching.

#### Scenario: YouTube auto-generated channel
- **WHEN** title is "Jay Chou - Mojito" and channel is "Jay Chou - Topic"
- **THEN** the system matches "Jay Chou" from title with cleaned channel "Jay Chou"

### Requirement: Lyrics search MUST use both title and artist separately
When calling LRCLIB, NetEase, or Genius APIs, the system SHALL pass the extracted song title as `title` and the cleaned artist name as `artist` as separate parameters, not concatenated.

#### Scenario: LRCLIB search with extracted title and artist
- **WHEN** searching lyrics for "Adele - Hello" from channel "Adele"
- **THEN** LRCLIB is called with track_name="Hello" and artist_name="Adele"

#### Scenario: NetEase search with Chinese title
- **WHEN** title is "周杰倫 Jay Chou【告白氣球】" and channel is "周杰倫 Jay Chou"
- **THEN** cleanSongTitle extracts "告白氣球" and NetEase search uses it with artist "周杰倫"

### Requirement: Extraction MUST log results for debugging
The system SHALL log the original title, extracted song title, and extracted artist for every lyrics search request.

#### Scenario: Debug logging
- **WHEN** any lyrics search is initiated
- **THEN** the console logs the original title, extracted title, and extracted artist with a recognizable prefix
