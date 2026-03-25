## 1. Database Schema & Migration

- [x] 1.1 Add `track_styles` table: video_id (PK), mood, genre, subgenre, energy, language, themes (JSON), analyzed_at
- [x] 1.2 Add `skip_count` and `complete_count` columns to `cached_tracks` table
- [x] 1.3 Test: verify migration runs cleanly on existing database

## 2. Style Analysis (Gemini Integration)

- [x] 2.1 Add `analyzeTrackStyle()` method to `gemini.service.ts` with constrained prompt (mood enum, energy enum)
- [x] 2.2 Add style caching: check `track_styles` before calling Gemini, store results after
- [x] 2.3 Add `POST /api/tracks/:videoId/style` endpoint
- [x] 2.4 Add background batch analyzer: queue uncached tracks, process with 6s interval
- [x] 2.5 Add priority analysis: currently-playing track jumps the queue
- [x] 2.6 Write unit tests for style analysis (mock Gemini, verify JSON parsing, error handling)
- [x] 2.7 Test: analyze 5 tracks manually, verify style JSON quality
- [x] 2.8 Update spec, commit, push

## 3. Style-Based Recommendation Scoring

- [x] 3.1 Define mood adjacency matrix and energy adjacency scale
- [x] 3.2 Implement `calculateStyleSimilarity()` function (40% mood+energy, 30% genre, 20% themes, 10% channel)
- [x] 3.3 Integrate into `GET /api/recommendations/similar/:videoId` — use style scoring when available, fallback to tags
- [x] 3.4 Add `reason` string to each recommendation result
- [x] 3.5 Write unit tests for style similarity (exact match, adjacent mood, cross-genre, fallback)
- [x] 3.6 Test: verify recommendations improve for tracks with style data
- [x] 3.7 Update spec, commit, push

## 4. Playback Signal Tracking

- [x] 4.1 Add `POST /api/tracks/:videoId/signal` endpoint (skip/complete)
- [x] 4.2 Frontend: emit complete signal on `ended` or `currentTime >= duration * 0.9`
- [x] 4.3 Frontend: emit skip signal when user clicks next/selects track AND `currentTime < duration * 0.5`
- [x] 4.4 Apply skip/complete ratio penalty/bonus in recommendation scoring
- [x] 4.5 Write unit tests for signal recording and scoring adjustment
- [x] 4.6 Update spec, commit, push

## 5. User Preference Profile

- [x] 5.1 Add `GET /api/recommendations/profile` endpoint
- [x] 5.2 Implement profile generation: aggregate top 50 tracks' styles into weighted preferences
- [x] 5.3 Cache profile in settings table, refresh weekly or after 20+ new plays
- [x] 5.4 Write unit tests for profile aggregation logic
- [x] 5.5 Update spec, commit, push

## 6. Frontend UI

- [x] 6.1 Display recommendation reasons in `ChannelSection.tsx` (e.g., "Similar mood: chill indie")
- [x] 6.2 Trigger style analysis for currently-playing track on play
- [x] 6.3 Update spec, commit, push

## 7. Integration Testing

- [x] 7.1 Unit test: style analysis mock + enum validation (5 tests)
- [x] 7.2 Unit test: style similarity scoring + adjacency + skip/complete (12 tests)
- [x] 7.3 All 48 tests passing
- [x] 7.4 Final commit, push
