## 1. Database Schema & Migration

- [ ] 1.1 Add `track_styles` table: video_id (PK), mood, genre, subgenre, energy, language, themes (JSON), analyzed_at
- [ ] 1.2 Add `skip_count` and `complete_count` columns to `cached_tracks` table
- [ ] 1.3 Test: verify migration runs cleanly on existing database

## 2. Style Analysis (Gemini Integration)

- [ ] 2.1 Add `analyzeTrackStyle()` method to `gemini.service.ts` with constrained prompt (mood enum, energy enum)
- [ ] 2.2 Add style caching: check `track_styles` before calling Gemini, store results after
- [ ] 2.3 Add `POST /api/tracks/:videoId/style` endpoint
- [ ] 2.4 Add background batch analyzer: queue uncached tracks, process with 6s interval
- [ ] 2.5 Add priority analysis: currently-playing track jumps the queue
- [ ] 2.6 Write unit tests for style analysis (mock Gemini, verify JSON parsing, error handling)
- [ ] 2.7 Test: analyze 5 tracks manually, verify style JSON quality
- [ ] 2.8 Update spec, commit, push

## 3. Style-Based Recommendation Scoring

- [ ] 3.1 Define mood adjacency matrix and energy adjacency scale
- [ ] 3.2 Implement `calculateStyleSimilarity()` function (40% mood+energy, 30% genre, 20% themes, 10% channel)
- [ ] 3.3 Integrate into `GET /api/recommendations/similar/:videoId` — use style scoring when available, fallback to tags
- [ ] 3.4 Add `reason` string to each recommendation result
- [ ] 3.5 Write unit tests for style similarity (exact match, adjacent mood, cross-genre, fallback)
- [ ] 3.6 Test: verify recommendations improve for tracks with style data
- [ ] 3.7 Update spec, commit, push

## 4. Playback Signal Tracking

- [ ] 4.1 Add `POST /api/tracks/:videoId/signal` endpoint (skip/complete)
- [ ] 4.2 Frontend: emit complete signal on `ended` or `currentTime >= duration * 0.9`
- [ ] 4.3 Frontend: emit skip signal when user clicks next/selects track AND `currentTime < duration * 0.5`
- [ ] 4.4 Apply skip/complete ratio penalty/bonus in recommendation scoring
- [ ] 4.5 Write unit tests for signal recording and scoring adjustment
- [ ] 4.6 Update spec, commit, push

## 5. User Preference Profile

- [ ] 5.1 Add `GET /api/recommendations/profile` endpoint
- [ ] 5.2 Implement profile generation: aggregate top 50 tracks' styles into weighted preferences
- [ ] 5.3 Cache profile in settings table, refresh weekly or after 20+ new plays
- [ ] 5.4 Write unit tests for profile aggregation logic
- [ ] 5.5 Update spec, commit, push

## 6. Frontend UI

- [ ] 6.1 Display recommendation reasons in `ChannelSection.tsx` (e.g., "Similar mood: chill indie")
- [ ] 6.2 Trigger style analysis for currently-playing track on play
- [ ] 6.3 Update spec, commit, push

## 7. Integration Testing

- [ ] 7.1 E2E test: play track → style analyzed → similar tracks use style scoring
- [ ] 7.2 E2E test: skip 5 tracks → verify skip penalty applied in recommendations
- [ ] 7.3 E2E test: play 50+ tracks → verify user profile generated
- [ ] 7.4 Final commit, push
