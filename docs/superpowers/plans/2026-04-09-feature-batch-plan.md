# Feature Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 10 features to bring home-media closer to YouTube Music / Spotify experience.

**Architecture:** Each feature is independent. Backend uses Express + SQLite, frontend uses React + Redux + MUI. Socket.io for real-time. Existing patterns: Redux slice per domain, API service singleton, Socket handler for broadcasts.

**Tech Stack:** React 18, Redux Toolkit, MUI 5, Express, SQLite (better-sqlite3), Socket.io, react-beautiful-dnd (already in deps)

---

## Task 1: 封鎖系統 — Backend (P0)

**Files:**
- Create: `backend/src/routes/block.routes.ts`
- Modify: `backend/src/config/database.ts` (add table)
- Modify: `backend/src/server.ts` (register routes)

- [ ] **Step 1.1:** Add `blocked_items` table to database.ts init

```sql
CREATE TABLE IF NOT EXISTS blocked_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('song', 'channel')),
  video_id TEXT,
  channel_name TEXT,
  title TEXT NOT NULL,
  thumbnail TEXT,
  blocked_at INTEGER NOT NULL
)
```

- [ ] **Step 1.2:** Create `block.routes.ts` with 3 endpoints:
- `GET /api/blocked` — return all blocked items
- `POST /api/block` — body: `{ type, videoId?, channelName?, title, thumbnail? }` → insert
- `DELETE /api/block/:id` — remove by id

- [ ] **Step 1.3:** Register in server.ts: `app.use('/api', blockRoutes)`

- [ ] **Step 1.4:** Verify backend compiles, commit

---

## Task 2: 封鎖系統 — Frontend (P0)

**Files:**
- Create: `frontend/src/store/blockSlice.ts`
- Modify: `frontend/src/store/index.ts` (add slice)
- Modify: `frontend/src/components/Search/SearchResults.tsx` (blocked indicator + menu)
- Modify: `frontend/src/components/Player/FullscreenLyrics.tsx` (playlist blocked indicator + menu)
- Modify: `frontend/src/hooks/useAutoQueue.ts` (filter blocked)
- Modify: `frontend/src/components/Settings/SettingsPage.tsx` (block management)
- Modify: `frontend/src/App.tsx` (load blocked on init)

- [ ] **Step 2.1:** Create `blockSlice.ts` — state: `items: BlockedItem[]`, actions: `setBlocked`, `addBlocked`, `removeBlocked`. Thunks: `fetchBlocked`, `blockItem`, `unblockItem`.

- [ ] **Step 2.2:** Register in store/index.ts

- [ ] **Step 2.3:** App.tsx — dispatch `fetchBlocked()` on init

- [ ] **Step 2.4:** SearchResults.tsx — check if each result is blocked (by videoId or channelName). If blocked: gray overlay + 🚫 icon, still clickable. Add ⋮ IconButton per card → Menu with「封鎖這首歌」「封鎖此頻道」. On block: dispatch `blockItem()` + show Snackbar with 5s undo.

- [ ] **Step 2.5:** FullscreenLyrics.tsx playlist section — same blocked indicator. Add long-press or ⋮ menu on playlist items.

- [ ] **Step 2.6:** useAutoQueue.ts — filter out blocked songs/channels from recommendations before appending.

- [ ] **Step 2.7:** SettingsPage.tsx — add「封鎖管理」section. Two sub-lists: blocked songs + blocked channels. Each shows thumbnail + title + date + 「解除封鎖」button.

- [ ] **Step 2.8:** Verify frontend compiles, commit

---

## Task 3: Lazy Loading 優化 (P0)

**Files:**
- Modify: `frontend/src/components/Home/HomeRecommendations.tsx` (pre-fetch trigger)
- Modify: `frontend/src/components/Home/ChannelSection.tsx` (horizontal lazy)
- Modify: `frontend/src/components/Search/SearchResults.tsx` (pre-fetch trigger)

- [ ] **Step 3.1:** HomeRecommendations.tsx — change IntersectionObserver `rootMargin` from default to `'0px 0px 600px 0px'` so next batch loads 600px before reaching bottom.

- [ ] **Step 3.2:** ChannelSection.tsx — if channel cards are rendered all at once, change to show first 6, add IntersectionObserver on last visible card, load 6 more on trigger. Add skeleton placeholder during load.

- [ ] **Step 3.3:** SearchResults.tsx — rootMargin already `200px`, increase to `400px` for earlier trigger.

- [ ] **Step 3.4:** Verify, commit

---

## Task 4: 翻譯歌詞廣播 (P0)

**Files:**
- Modify: `backend/src/handlers/lyrics.handler.ts` (add translation-ready event)
- Modify: `backend/src/routes/track.routes.ts` (emit after translate success)
- Modify: `frontend/src/hooks/useLyricsSync.ts` (listen for translation-ready)
- Modify: `frontend/src/components/Player/FullscreenLyrics.tsx` (consume broadcast translation)

- [ ] **Step 4.1:** Backend — in track.routes.ts translate endpoint, after successful translation (both cached and fresh), emit socket event. Need access to io instance. Import from server.ts or pass via app.locals.

```typescript
const io = req.app.get('io') as Server;
io.emit('lyrics:translation-ready', { videoId, translations: result.translations });
```

- [ ] **Step 4.2:** Frontend useLyricsSync.ts — listen for `lyrics:translation-ready`. When received and `videoId` matches current track, call a callback to set translations.

- [ ] **Step 4.3:** FullscreenLyrics.tsx — pass a `setTranslations` callback to useLyricsSync or use a Redux action. When translation broadcast arrives, skip doTranslate entirely.

- [ ] **Step 4.4:** Verify, commit

---

## Task 5: 優化歌詞翻譯品質 (P1)

**Files:**
- Modify: `backend/src/services/gemini.service.ts` (prompt improvement)
- Modify: `frontend/src/components/Player/FullscreenLyrics.tsx` (mismatch indicator)

- [ ] **Step 5.1:** gemini.service.ts — enhance translateLyrics prompt:
- Add: "You MUST translate every single line. Do NOT skip any line index."
- Add: "The output JSON MUST have exactly N keys matching the input line count."
- Add validation: if returned object has < 80% of expected keys, retry.

- [ ] **Step 5.2:** FullscreenLyrics.tsx — if translations.length > 0 but many are empty strings (>50% empty), show a small warning chip「翻譯不完整，點擊重試」.

- [ ] **Step 5.3:** Verify, commit

---

## Task 6: 佇列 UI 優化 (P1)

**Files:**
- Modify: `frontend/src/components/Player/FullscreenLyrics.tsx` (playlist section rewrite)
- Modify: `frontend/src/store/playerSlice.ts` (add reorder/remove/insertNext actions)

- [ ] **Step 6.1:** playerSlice.ts — add actions:
- `reorderPlaylist(fromIndex, toIndex)` — move track
- `removeFromPlaylist(index)` — remove track, adjust currentIndex
- `insertNext(track)` — insert at currentIndex + 1

- [ ] **Step 6.2:** FullscreenLyrics.tsx playlist section — wrap List with `DragDropContext` + `Droppable` + `Draggable` from react-beautiful-dnd. Add drag handle icon. On drag end, dispatch `reorderPlaylist`.

- [ ] **Step 6.3:** Add swipe-to-delete or long-press menu per item:「移除」「插隊播放」. On mobile, use IconButton with delete icon that appears on hover/focus.

- [ ] **Step 6.4:** Auto-scroll to currently playing track on open.

- [ ] **Step 6.5:** Verify, commit

---

## Task 7: 無縫切歌 Gapless (P1)

**Files:**
- Modify: `frontend/src/components/Player/AudioPlayer.tsx` (fade transition in quickStartNextTrack)

- [ ] **Step 7.1:** Modify `quickStartNextTrack()` — instead of instant src swap:

```typescript
// 1. Fade out current (300ms)
const fadeOut = () => new Promise<void>(resolve => {
  const start = audioEl.volume;
  const step = start / 15; // 15 steps × 20ms = 300ms
  const timer = setInterval(() => {
    audioEl.volume = Math.max(0, audioEl.volume - step);
    if (audioEl.volume <= 0.01) { clearInterval(timer); audioEl.volume = 0; resolve(); }
  }, 20);
});

// 2. Swap src + play
await fadeOut();
audioEl.src = blobUrl;
audioEl.volume = 0;
audioEl.play();

// 3. Fade in (300ms)
const targetVol = volume; // from Redux
const stepIn = targetVol / 15;
const fadeInTimer = setInterval(() => {
  audioEl.volume = Math.min(targetVol, audioEl.volume + stepIn);
  if (audioEl.volume >= targetVol - 0.01) { clearInterval(fadeInTimer); audioEl.volume = targetVol; }
}, 20);
```

- [ ] **Step 7.2:** Also apply fade to normal `dispatch(playNext())` path (handleEnded when no quickStart available). This requires making confirmAndPlay do a fade-in after play.

- [ ] **Step 7.3:** Verify, commit

---

## Task 8: ❤️ 收藏系統 (P2)

**Files:**
- Create: `backend/src/routes/favorites.routes.ts`
- Create: `frontend/src/store/favoritesSlice.ts`
- Modify: `backend/src/config/database.ts` (add table)
- Modify: `backend/src/server.ts` (register routes)
- Modify: `frontend/src/store/index.ts`
- Modify: `frontend/src/App.tsx` (load favorites on init)
- Modify: `frontend/src/components/Search/SearchResults.tsx` (❤️ button)
- Modify: `frontend/src/components/Player/AudioPlayer.tsx` (❤️ in mini player)
- Modify: `frontend/src/components/Player/FullscreenLyrics.tsx` (❤️ in header)
- Modify: `backend/src/services/recommendation.service.ts` (weight boost)

- [ ] **Step 8.1:** Backend — `favorites` table + CRUD routes (POST toggle, GET list, GET check)
- [ ] **Step 8.2:** Frontend — `favoritesSlice` + thunks
- [ ] **Step 8.3:** Add ❤️ IconButton to SearchResults, mini player (AudioPlayer), FullscreenLyrics header
- [ ] **Step 8.4:** recommendation.service.ts — boost favorited songs/channels weight ×3
- [ ] **Step 8.5:** Verify, commit

---

## Task 9: 首頁個人化推薦牆 (P2)

**Files:**
- Create: `backend/src/routes/personalized.routes.ts`
- Create: `frontend/src/components/Home/PersonalizedSection.tsx`
- Modify: `frontend/src/components/Home/HomeRecommendations.tsx` (add sections at top)
- Modify: `backend/src/server.ts`

- [ ] **Step 9.1:** Backend — `GET /api/recommendations/personalized` returns:
- `recentlyPlayed`: top 10 by `last_played DESC` from cached_tracks where play_count > 0
- `forYou`: mix of high play_count + favorited tracks' similar artists (reuse existing recommendation logic)
- `newForYou`: Gemini discovery based on top 5 most-played artists

- [ ] **Step 9.2:** Frontend — `PersonalizedSection.tsx` renders 3 horizontal scroll rows:「最近播放」「為你推薦」「你可能喜歡」. Each is a horizontal scrollable Box with cards.

- [ ] **Step 9.3:** HomeRecommendations.tsx — render PersonalizedSection at top before channel recommendations.

- [ ] **Step 9.4:** Verify, commit

---

## Task 10: 播放紀錄頁面 (P2)

**Files:**
- Create: `backend/src/routes/history-playback.routes.ts`
- Create: `frontend/src/components/History/PlaybackHistory.tsx`
- Modify: `backend/src/config/database.ts` (ensure `last_played` updated on signal)
- Modify: `backend/src/routes/track.routes.ts` (update `last_played` on complete signal)
- Modify: `backend/src/server.ts`
- Modify: `frontend/src/App.tsx` (add route)

- [ ] **Step 10.1:** Backend — track.routes.ts signal endpoint: on `complete`, also update `last_played = Date.now()`.

- [ ] **Step 10.2:** Backend — `GET /api/history/playback?page=1&limit=50` returns cached_tracks ordered by last_played DESC, grouped by date.

- [ ] **Step 10.3:** Frontend — PlaybackHistory.tsx page: grouped list (今天/昨天/本週/更早), each item shows thumbnail + title + channel + play count + last played time. Click to play.

- [ ] **Step 10.4:** Add route in App.tsx or as a section in the 播放清單 tab.

- [ ] **Step 10.5:** Verify, commit

---

## Task 11: 搜尋結果分類 Tab (P2)

**Files:**
- Modify: `frontend/src/components/Search/SearchResults.tsx` (add tab filter)

- [ ] **Step 11.1:** Add MUI Tabs above results:「全部」「歌曲」「頻道」「播放清單」

- [ ] **Step 11.2:** Filter logic (pure frontend):
- 全部: no filter
- 歌曲: `duration < 600` (10 min)
- 頻道: group results by `channel`, show channel card with count + first 3 songs
- 播放清單: search user's saved playlists for title match

- [ ] **Step 11.3:** Persist selected tab in state (reset on new search)

- [ ] **Step 11.4:** Verify, commit

---

## Task 12: Final Integration & CLAUDE.md

- [ ] **Step 12.1:** Full TypeScript compilation check (frontend + backend)
- [ ] **Step 12.2:** Update CLAUDE.md with new patterns
- [ ] **Step 12.3:** Update openspec
- [ ] **Step 12.4:** Update memory
- [ ] **Step 12.5:** Final commit + push
