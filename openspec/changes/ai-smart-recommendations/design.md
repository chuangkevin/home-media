## Context

Home-media's recommendation engine currently uses two approaches: (1) channel-based homepage recommendations sorted by `lastWatchedAt` timestamp, and (2) similar-track matching using YouTube tag Jaccard similarity + optional Spotify audio features. Without Spotify, recommendations degrade to tag/title string matching, which cannot understand mood, energy, or thematic connections across genres.

Gemini 2.5 Flash is already integrated (`gemini.service.ts`) for lyrics title extraction with API key pool, round-robin rotation, and 429 retry. The free tier provides ~1,500 RPD and 10 RPM — sufficient for per-track analysis since users typically play 50-200 tracks/day.

**Current scoring (YouTube-only, no Spotify):**
- 50% tag similarity (Jaccard index)
- 30% same channel bonus
- 20% title word similarity

## Goals / Non-Goals

**Goals:**
- Understand song mood/genre/energy without Spotify
- Recommend across genres with similar vibes (e.g., chill jazz → chill indie)
- Learn user preferences from listening history
- Provide transparent recommendation reasons
- Track skip/complete for quality signals

**Non-Goals:**
- Real-time audio analysis (no waveform/spectral analysis)
- Social recommendations (no multi-user collaborative filtering)
- Replacing Spotify integration (keep as optional enhancement)
- Lyrics content analysis (future scope)

## Decisions

### D1: Gemini prompt returns structured JSON style profile

**Choice:** Single prompt per track → `{mood, genre, subgenre, energy, language, themes}`.

**Prompt design:**
```
Analyze this song and return JSON only:
Title: "羊文学 – Feel (Official Music Video)"
Channel: "羊文学"
Tags: ["羊文学", "J-Rock", "indie"]
Category: "Music"

{"mood": "one of: energetic/chill/melancholic/upbeat/dark/dreamy/aggressive/romantic",
 "genre": "primary genre",
 "subgenre": "specific subgenre",
 "energy": "one of: very-low/low/medium/high/very-high",
 "language": "ISO 639-1 code",
 "themes": ["max 3 thematic keywords"]}
```

**Why structured enum values:** Enables direct vector comparison without NLP. A "chill" mood always matches another "chill" mood.

**Alternative considered:** Free-text description. Rejected because comparison requires NLP/embedding, adding complexity and latency.

### D2: Cache style in `track_styles` table, never re-analyze

**Choice:** Analyze once per `video_id`, store forever. No TTL expiration.

**Why:** Song style doesn't change. Re-analyzing wastes free tier quota. If Gemini model improves, user can manually trigger re-analysis via admin.

### D3: Style-vector similarity scoring replaces tag matching

**Choice:** New scoring weights when style data is available:
- 40% mood + energy match (exact match = 1.0, adjacent = 0.5, different = 0)
- 30% genre + subgenre match (exact genre = 1.0, same genre different subgenre = 0.7)
- 20% theme overlap (Jaccard index on themes array)
- 10% same channel bonus

**Fallback:** When either track lacks style data, use existing tag/title scoring.

**Why over weighted cosine:** Enum-based matching is simpler, debuggable, and doesn't require embedding vectors. The 8 mood categories and 5 energy levels are sufficient for music recommendation.

### D4: Mood adjacency matrix for fuzzy matching

**Choice:** Define adjacent moods for partial matching:
```
energetic ↔ upbeat (0.5)
chill ↔ dreamy (0.5)
melancholic ↔ dark (0.5)
romantic ↔ dreamy (0.5)
aggressive ↔ energetic (0.5)
```

Energy adjacency: `very-low ↔ low ↔ medium ↔ high ↔ very-high` (adjacent = 0.5)

### D5: User preference profile via batch Gemini analysis

**Choice:** Analyze top 50 most-played tracks' styles → aggregate into preference profile:
```json
{
  "preferredMoods": {"chill": 0.4, "energetic": 0.3, "melancholic": 0.2},
  "preferredGenres": {"indie-rock": 0.35, "j-pop": 0.25, "lo-fi": 0.2},
  "preferredEnergy": {"medium": 0.5, "low": 0.3},
  "preferredLanguages": {"ja": 0.5, "en": 0.3, "zh": 0.2},
  "topThemes": ["youth", "nostalgia", "love"],
  "generatedAt": 1711360000000
}
```

**Refresh:** Weekly or when 20+ new tracks are played since last generation. Stored in `settings` table as JSON.

### D6: Background batch analysis with rate limiting

**Choice:** After search results return, queue uncached tracks for style analysis. Process sequentially with 6-second intervals (10 RPM limit). Use existing `precacheVideos` pattern.

**Why not real-time:** Free tier's 10 RPM means we can't analyze 20 search results instantly. Background analysis ensures the first few tracks are analyzed before the user finishes listening to the first song.

### D7: Skip/complete tracking via frontend events

**Choice:** Track two new counters on `cached_tracks`: `skip_count` and `complete_count`.
- **Skip:** `timeupdate` with `currentTime < duration * 0.5` AND user clicks next/selects another track
- **Complete:** `ended` event fires OR `currentTime >= duration * 0.9`

**Why 50% threshold for skip:** Anything less than half suggests disinterest. 90% for complete accounts for tracks with long outros.

## Risks / Trade-offs

- **[Risk] Gemini style analysis inconsistency** → Mitigation: Use constrained enum values; cache results permanently; manual re-analyze option
- **[Risk] Free tier exhaustion with heavy use** → Mitigation: 6-second interval; skip already-analyzed tracks; API key pool rotation
- **[Risk] Cold start with no analyzed tracks** → Mitigation: Fall back to existing tag matching; prioritize analyzing currently-playing and next-in-queue tracks
- **[Risk] Mood categorization subjectivity** → Mitigation: 8 broad categories reduce ambiguity; adjacency matrix handles edge cases
