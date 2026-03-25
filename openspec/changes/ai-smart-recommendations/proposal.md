## Why

The current recommendation system relies on YouTube tag string matching and channel timestamp sorting, producing shallow, repetitive recommendations. Without Spotify (which most users don't configure), the system cannot understand song mood, genre, or energy — making it impossible to recommend across genres with similar vibes. Gemini 2.5 Flash is already integrated and free, making AI-powered style analysis a zero-cost upgrade.

## What Changes

- Add Gemini-powered song style analyzer: extract mood, genre, subgenre, energy, language, and themes from track metadata
- Cache style analysis results in a new `track_styles` table (analyze once, reuse forever)
- Replace tag-only similarity scoring with style-vector-based matching (mood+energy 40%, genre 30%, themes 20%, channel 10%)
- Add user preference profile endpoint: summarize listening taste from top played tracks
- Track skip/complete events for better quality signals
- Background batch analysis of uncached track styles (respecting free tier 10 RPM limit)
- Display recommendation reasons in the frontend ("Similar mood: chill indie")

## Capabilities

### New Capabilities
- `style-analysis`: Gemini-based song style/mood extraction with caching
- `style-recommendations`: Style-vector similarity matching engine replacing tag-only matching
- `user-preference-profile`: AI-generated user taste summary from listening history
- `playback-signals`: Skip/complete event tracking for recommendation quality

### Modified Capabilities

## Impact

- **Backend**: `gemini.service.ts` (new analysis method), `genre-recommendations.routes.ts` (new scoring), `recommendation.service.ts` (preference profile), `database.ts` (new table + schema changes)
- **Frontend**: `ChannelSection.tsx` (show recommendation reasons), `AudioPlayer.tsx` (emit skip/complete events), `useAutoQueue.ts` (use style-based API)
- **APIs**: New `GET /api/recommendations/profile`, new `POST /api/tracks/:videoId/style`, modified `GET /api/recommendations/similar/:videoId`
- **Dependencies**: No new dependencies (uses existing `@google/generative-ai`)
- **Risk**: Free tier rate limits (10 RPM) require sequential analysis; style results vary by Gemini model version
