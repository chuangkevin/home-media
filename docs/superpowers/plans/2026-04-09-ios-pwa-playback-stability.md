# iOS PWA Playback Stability & Video Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix iOS PWA auto-next failure on lock screen, improve video A/V sync, add video lyrics overlay, and handle PWA crash recovery.

**Architecture:** The root cause of auto-next failure is iOS killing the PWA process entirely (not just suspending JS). When iOS reclaims the web view, all JS state, timers, and event listeners are gone. The fix is two-pronged: (1) reduce memory pressure so iOS kills the PWA less often, (2) persist full playback state so the PWA can auto-resume after a kill+reload. Video sync uses the existing playbackRate micro-adjust approach with tighter parameters.

**Tech Stack:** React 18, Redux Toolkit, HTMLAudioElement, Media Session API, IndexedDB (audio-cache), localStorage (session state), YouTube IFrame API

---

## Root Cause Analysis

**Why auto-next fails on iOS PWA lock screen:**

1. iOS PWA runs in a WKWebView with aggressive memory management
2. When screen locks, iOS may SUSPEND the web process (JS frozen) or KILL it entirely
3. If suspended: audio continues (OS audio session), but `ended`/`timeupdate` events queue until resume
4. If killed: PWA reloads from scratch on unlock — black screen, all state lost
5. All current fallback layers (setTimeout, setInterval, visibilitychange, Media Session position check) require JS to be running — they all fail against a process kill

**Evidence:** User reports black screen + full reload on unlock = process was killed, not just suspended.

**Strategy:**

| Layer | What it handles | How |
|-------|----------------|-----|
| 1. Memory reduction | Prevent iOS from killing PWA | Remove heavy DOM when backgrounded |
| 2. State persistence | Recover from kill+reload | Save playlist/index/time to localStorage every 5s |
| 3. Ended event | Handle JS-suspended case | Already exists, works when JS resumes |
| 4. Existing fallbacks | Belt-and-suspenders | setTimeout, setInterval, visibility — keep as-is |

## File Structure

### New files
- `frontend/src/services/playback-state.service.ts` — Persist/restore playback session (playlist, index, time, volume)
- `frontend/src/hooks/usePlaybackPersistence.ts` — Hook that auto-saves state and detects crash recovery
- `frontend/src/components/Player/VideoLyricsOverlay.tsx` — Current lyric line overlay on video tab

### Modified files
- `frontend/src/components/Player/AudioPlayer.tsx` — Integrate persistence hook, reduce background timers
- `frontend/src/components/Player/FullscreenLyrics.tsx` — Unmount heavy video DOM when backgrounded, add overlay
- `frontend/src/components/Player/VideoPlayer.tsx` — Tighten sync parameters, add playbackRate micro-adjust
- `frontend/src/App.tsx` — Restore from persisted state instead of URL-only

---

## Task 1: Playback State Persistence Service

**Files:**
- Create: `frontend/src/services/playback-state.service.ts`

This service saves and restores the full playback session so the PWA can resume after iOS kills and reloads it.

- [ ] **Step 1.1: Create the persistence service**

```typescript
// frontend/src/services/playback-state.service.ts

const STORAGE_KEY = 'hm-playback-state';
const SAVE_INTERVAL = 5000; // 5s

export interface PersistedPlaybackState {
  playlist: Array<{
    id: string;
    videoId: string;
    title: string;
    channel: string;
    thumbnail: string;
    duration: number;
  }>;
  currentIndex: number;
  currentTime: number;
  volume: number;
  isPlaying: boolean;
  savedAt: number; // Date.now()
}

class PlaybackStateService {
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private lastState: PersistedPlaybackState | null = null;

  save(state: PersistedPlaybackState): void {
    this.lastState = state;
  }

  /** Flush current state to localStorage immediately */
  flush(): void {
    if (!this.lastState) return;
    try {
      this.lastState.savedAt = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.lastState));
    } catch {
      // localStorage full or unavailable — non-fatal
    }
  }

  /** Start periodic save (call once on mount) */
  startAutoSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setInterval(() => this.flush(), SAVE_INTERVAL);
    // Also flush on visibilitychange hidden (last chance before iOS kills us)
    document.addEventListener('visibilitychange', this.handleVisibility);
  }

  stopAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    document.removeEventListener('visibilitychange', this.handleVisibility);
  }

  private handleVisibility = (): void => {
    if (document.hidden) this.flush();
  };

  /** Restore persisted state. Returns null if none or too stale (>24h). */
  restore(): PersistedPlaybackState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const state: PersistedPlaybackState = JSON.parse(raw);
      // Discard if older than 24 hours
      if (Date.now() - state.savedAt > 24 * 60 * 60 * 1000) {
        this.clear();
        return null;
      }
      // Discard if playlist is empty
      if (!state.playlist?.length) {
        this.clear();
        return null;
      }
      return state;
    } catch {
      return null;
    }
  }

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.lastState = null;
  }
}

export default new PlaybackStateService();
```

- [ ] **Step 1.2: Verify file compiles**

Run: `cd D:/Projects/_HomeProject/home-media/frontend && npx tsc --noEmit src/services/playback-state.service.ts 2>&1 | head -20`
Expected: No errors (or only errors from missing imports that exist in the project)

- [ ] **Step 1.3: Commit**

```bash
git add frontend/src/services/playback-state.service.ts
git commit -m "feat: add playback state persistence service for iOS PWA crash recovery"
```

---

## Task 2: Playback Persistence Hook

**Files:**
- Create: `frontend/src/hooks/usePlaybackPersistence.ts`

This hook connects Redux state to the persistence service and handles the restore-on-reload flow.

- [ ] **Step 2.1: Create the persistence hook**

```typescript
// frontend/src/hooks/usePlaybackPersistence.ts

import { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import playbackStateService from '../services/playback-state.service';

/**
 * Auto-saves playback state every 5s + on visibilitychange.
 * Call this once in AudioPlayer (non-embedded only).
 */
export function usePlaybackPersistence(): void {
  const { playlist, currentIndex, currentTime, volume, isPlaying } = useSelector(
    (state: RootState) => state.player,
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Keep a ref to the audio element for accurate currentTime
  useEffect(() => {
    audioRef.current = document.querySelector('audio') as HTMLAudioElement | null;
  });

  // Push latest state to service on every relevant change
  useEffect(() => {
    if (playlist.length === 0) return;

    playbackStateService.save({
      playlist: playlist.map(t => ({
        id: t.id,
        videoId: t.videoId,
        title: t.title,
        channel: t.channel,
        thumbnail: t.thumbnail || '',
        duration: t.duration || 0,
      })),
      currentIndex,
      // Use audio element's currentTime for accuracy (Redux may lag)
      currentTime: audioRef.current?.currentTime ?? currentTime,
      volume,
      isPlaying,
      savedAt: Date.now(),
    });
  }, [playlist, currentIndex, currentTime, volume, isPlaying]);

  // Start/stop auto-save lifecycle
  useEffect(() => {
    playbackStateService.startAutoSave();
    return () => playbackStateService.stopAutoSave();
  }, []);
}
```

- [ ] **Step 2.2: Commit**

```bash
git add frontend/src/hooks/usePlaybackPersistence.ts
git commit -m "feat: add usePlaybackPersistence hook for auto-saving playback state"
```

---

## Task 3: Integrate Persistence into AudioPlayer + App Restore

**Files:**
- Modify: `frontend/src/components/Player/AudioPlayer.tsx` (add hook call)
- Modify: `frontend/src/App.tsx` (restore from persisted state)

- [ ] **Step 3.1: Add persistence hook to AudioPlayer**

In `AudioPlayer.tsx`, add import and call the hook after the existing `useAutoQueue` call (around line 51):

```typescript
// Add import at top
import { usePlaybackPersistence } from '../../hooks/usePlaybackPersistence';
```

After line 51 (`useAutoQueue(!embedded);`), add:

```typescript
  // 💾 Auto-save playback state for iOS PWA crash recovery
  usePlaybackPersistence();
```

Note: The hook internally does nothing if playlist is empty, so no guard needed.

- [ ] **Step 3.2: Enhance App.tsx restore logic**

In `App.tsx`, modify the restore effect (lines 220-258) to check persisted state first, then fall back to URL param:

Add import at top of App.tsx:

```typescript
import playbackStateService from './services/playback-state.service';
```

Replace the existing restore effect (the `useEffect` at line 220 with `searchParams.get('playing')`) with:

```typescript
  // 頁面載入/重整時，從持久化狀態或 URL 恢復播放
  useEffect(() => {
    if (currentTrack) return; // Already have a track, skip restore

    const restoreFromPersisted = async () => {
      const persisted = playbackStateService.restore();
      if (persisted && persisted.playlist.length > 0) {
        console.log(`🔄 [PWA Recovery] Restoring session: ${persisted.playlist.length} tracks, index=${persisted.currentIndex}, time=${persisted.currentTime.toFixed(1)}s`);
        
        dispatch(setPlaylist(persisted.playlist as Track[]));
        
        const track = persisted.playlist[persisted.currentIndex] || persisted.playlist[0];
        dispatch(setPendingTrack(track as Track));
        dispatch(setIsPlaying(true));
        
        // Open lyrics drawer so user sees playback resumed
        setLyricsDrawerOpen(true);
        
        // Clear persisted state after successful restore (will be re-saved by hook)
        playbackStateService.clear();
        return true;
      }
      return false;
    };

    const restoreFromUrl = async () => {
      const playingVideoId = searchParams.get('playing');
      if (!playingVideoId) return;

      const cached = await audioCacheService.getMetadata(playingVideoId);
      const track: Track = {
        id: playingVideoId,
        videoId: playingVideoId,
        title: cached?.title || '載入中...',
        channel: cached?.channel || '',
        thumbnail: cached?.thumbnail || `https://i.ytimg.com/vi/${playingVideoId}/hqdefault.jpg`,
        duration: cached?.duration || 0,
      };
      dispatch(setPlaylist([track]));
      dispatch(setPendingTrack(track));
      dispatch(setIsPlaying(true));

      if (!cached) {
        apiService.getVideoInfo(playingVideoId).then(videoInfo => {
          dispatch(updateTrackMetadata({
            id: videoInfo.videoId,
            videoId: videoInfo.videoId,
            title: videoInfo.title,
            channel: videoInfo.channel,
            thumbnail: videoInfo.thumbnail,
            duration: videoInfo.duration,
          }));
        }).catch(() => {
          const newParams = new URLSearchParams(searchParams);
          newParams.delete('playing');
          setSearchParams(newParams, { replace: true });
        });
      }
    };

    // Try persisted state first (handles iOS PWA crash recovery), then URL
    restoreFromPersisted().then(restored => {
      if (!restored) restoreFromUrl();
    });
  }, []); // 只在頁面初始化時執行一次
```

- [ ] **Step 3.3: Add seek-to-saved-position in AudioPlayer pendingTrack effect**

In AudioPlayer.tsx, in the `confirmAndPlay` function (or wherever audio starts playing after pendingTrack loads), add logic to seek to persisted `currentTime` if this is a crash recovery:

Find the section where `audio.play()` is called after setting blob URL in the cached path. After the play call succeeds, add:

```typescript
        // iOS PWA crash recovery: seek to persisted position
        const persisted = playbackStateService.restore();
        if (persisted && persisted.currentTime > 5) {
          // Only seek if we have a meaningful position (>5s) to avoid seeking to 0
          const targetTime = Math.min(persisted.currentTime, track.duration || Infinity);
          audio.currentTime = targetTime;
          console.log(`🔄 [PWA Recovery] Seeked to ${targetTime.toFixed(1)}s`);
          playbackStateService.clear();
        }
```

Wait — this won't work cleanly because `restore()` is called in App.tsx and cleared there. Let me revise: instead of reading from the service again, pass the seek target through Redux.

Actually, simpler approach: save the seekTarget in a module-level variable in the persistence service:

Add to `playback-state.service.ts`:

```typescript
  /** One-shot seek target for crash recovery (consumed once by AudioPlayer) */
  private _recoverySeekTarget: number | null = null;

  setRecoverySeekTarget(time: number): void {
    this._recoverySeekTarget = time;
  }

  consumeRecoverySeekTarget(): number | null {
    const t = this._recoverySeekTarget;
    this._recoverySeekTarget = null;
    return t;
  }
```

In App.tsx restore logic, after `dispatch(setPendingTrack(...))`, add:

```typescript
        if (persisted.currentTime > 5) {
          playbackStateService.setRecoverySeekTarget(persisted.currentTime);
        }
```

In AudioPlayer.tsx `confirmAndPlay`, after `audio.play()` resolves:

```typescript
        // iOS PWA crash recovery: seek to persisted position
        const recoverySeek = playbackStateService.consumeRecoverySeekTarget();
        if (recoverySeek !== null) {
          audio.currentTime = Math.min(recoverySeek, track.duration || Infinity);
          console.log(`🔄 [PWA Recovery] Seeked to ${recoverySeek.toFixed(1)}s`);
        }
```

- [ ] **Step 3.4: Verify TypeScript compiles**

Run: `cd D:/Projects/_HomeProject/home-media/frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3.5: Commit**

```bash
git add frontend/src/components/Player/AudioPlayer.tsx frontend/src/App.tsx frontend/src/services/playback-state.service.ts
git commit -m "feat: integrate playback persistence — auto-save state + restore on PWA crash recovery"
```

---

## Task 4: Reduce iOS PWA Memory Pressure

**Files:**
- Modify: `frontend/src/components/Player/FullscreenLyrics.tsx`
- Modify: `frontend/src/components/Player/AudioPlayer.tsx`

The goal is to reduce the chance iOS kills the PWA by minimizing DOM weight and timer count when backgrounded.

- [ ] **Step 4.1: Unmount cached video element when not in video tab**

In `FullscreenLyrics.tsx`, find where `<video ref={cachedVideoRef} ...>` is rendered (around line 1104). Wrap it so the video element is only in the DOM when `viewMode === 'video'`:

Currently the video element is always rendered (just hidden). Change it to conditionally render:

```typescript
{viewMode === 'video' && videoCached && (
  <video
    ref={cachedVideoRef}
    // ... existing props
  />
)}
```

Also ensure `cachedVideoRef.current` is null-checked everywhere it's used (it already should be).

- [ ] **Step 4.2: Pause all non-essential intervals when document is hidden**

In `AudioPlayer.tsx`, the `iosBackgroundCheckInterval` (line 1197) and `checkFakePlayback` (line 1220) both run every 3s even in background. The `iosBackgroundCheckInterval` is intentionally for background — keep it. But `checkFakePlayback` is useless in background. Modify it:

In the `checkFakePlayback` interval body (line 1220), add at the start:

```typescript
      if (document.hidden) return; // Skip fake playback detection when backgrounded
```

- [ ] **Step 4.3: Consolidate background timers**

The Media Session `updatePositionState` interval (line 1430, every 1s) and the `iosBackgroundCheckInterval` (line 1197, every 3s) both check for end-of-track. They can share logic. However, since they're in separate `useEffect`s with different deps, merging them is complex. Instead, just ensure the Media Session interval skips work when hidden:

In the `updatePositionState` function (line 1394), add early return when backgrounded since iOS doesn't update the lock screen position bar from JS anyway:

```typescript
    const updatePositionState = () => {
      if (document.hidden) return; // iOS doesn't read positionState from background JS
      // ... existing code
    };
```

This removes the duplicate end-detection that was running in the Media Session interval. The `iosBackgroundCheckInterval` (3s) remains as the sole background checker.

- [ ] **Step 4.4: Commit**

```bash
git add frontend/src/components/Player/FullscreenLyrics.tsx frontend/src/components/Player/AudioPlayer.tsx
git commit -m "fix: reduce iOS PWA memory pressure — unmount video DOM when hidden, skip timers in background"
```

---

## Task 5: Improve Video A/V Sync (YouTube iframe)

**Files:**
- Modify: `frontend/src/components/Player/VideoPlayer.tsx`

The current iframe sync uses 1s interval with 2s drift tolerance. For music, 2s is too much. We'll tighten to 1s drift and add playbackRate micro-adjust for sub-1s drift.

- [ ] **Step 5.1: Replace hard-seek-only sync with playbackRate micro-adjust**

In `VideoPlayer.tsx`, replace the sync interval logic (around line 257-275):

```typescript
        // 定期同步 iframe 位置到 audio element（audio 是唯一音源）
        intervalRef.current = setInterval(() => {
          if (
            playerRef.current && 
            playerRef.current.getCurrentTime && 
            playerRef.current.seekTo && 
            isMounted && 
            !isSeekingRef.current &&
            !recoveryLockRef.current
          ) {
            const videoTime = playerRef.current.getCurrentTime();
            const audioTime = getAudioTime();
            const drift = audioTime - videoTime; // positive = video behind
            const absDrift = Math.abs(drift);

            if (absDrift > 1.0) {
              // Large drift: hard seek
              playerRef.current.seekTo(audioTime, true);
              console.log(`🎬 影片同步修正 (hard seek): drift=${drift.toFixed(2)}s`);
            } else if (absDrift > 0.3) {
              // Medium drift: playbackRate nudge
              // YouTube iframe setPlaybackRate is available
              try {
                const rate = drift > 0 ? 1.05 : 0.95;
                playerRef.current.setPlaybackRate(rate);
                // Reset rate after 1.5s
                setTimeout(() => {
                  if (playerRef.current?.setPlaybackRate) {
                    playerRef.current.setPlaybackRate(1);
                  }
                }, 1500);
              } catch {
                // setPlaybackRate may not be available on all embeds
                playerRef.current.seekTo(audioTime, true);
              }
            }
            // <0.3s drift: acceptable, do nothing
          }
        }, 800);
```

- [ ] **Step 5.2: Sync immediately on play state change**

Add a one-time sync when `isPlaying` changes to true. In the existing `useEffect` for play/pause (around line 304-313), after `playerRef.current.playVideo()`:

```typescript
    if (isPlaying && playerState !== 1) {
      playerRef.current.playVideo();
      // Immediate sync on resume
      setTimeout(() => {
        if (playerRef.current?.getCurrentTime && playerRef.current?.seekTo) {
          const audioTime = getAudioTime();
          playerRef.current.seekTo(audioTime, true);
        }
      }, 300);
    }
```

- [ ] **Step 5.3: Commit**

```bash
git add frontend/src/components/Player/VideoPlayer.tsx
git commit -m "fix: tighten video A/V sync — 1s hard seek threshold, playbackRate nudge for 0.3-1s drift"
```

---

## Task 6: Improve Cached Video Sync (FullscreenLyrics)

**Files:**
- Modify: `frontend/src/components/Player/FullscreenLyrics.tsx`

The cached video sync (line 456-528) already uses playbackRate micro-adjust, which is good. But the parameters can be tightened:
- Hard seek threshold: 0.9s → 0.7s (with same 4.5s cooldown)
- PlaybackRate range: 0.94-1.06 → 0.96-1.04 (less audible on video audio bleed)
- Sync interval: 800ms → 600ms

- [ ] **Step 6.1: Tighten cached video sync parameters**

In `FullscreenLyrics.tsx`, in the `syncOnce` function (around line 464-517):

Change the hard seek threshold (line 484):
```typescript
      if (absDrift >= 0.7) {  // was 0.9
```

Change the playbackRate range (line 498-502):
```typescript
      if (absDrift >= 0.10) {  // was 0.12
        const k = 0.06;  // was 0.08 — gentler adjustment
        const unclamped = 1 + drift * k;
        const targetRate = Math.max(0.96, Math.min(1.04, unclamped));  // was 0.94-1.06
```

Change the sync interval (line 520):
```typescript
    videoSyncIntervalRef.current = setInterval(syncOnce, 600);  // was 800
```

- [ ] **Step 6.2: Commit**

```bash
git add frontend/src/components/Player/FullscreenLyrics.tsx
git commit -m "fix: tighten cached video sync — 0.7s hard seek, 0.96-1.04 playbackRate range, 600ms interval"
```

---

## Task 7: Video Lyrics Overlay

**Files:**
- Create: `frontend/src/components/Player/VideoLyricsOverlay.tsx`
- Modify: `frontend/src/components/Player/FullscreenLyrics.tsx`

Show the current lyric line + translation overlaid on the video when in video tab.

- [ ] **Step 7.1: Create VideoLyricsOverlay component**

```typescript
// frontend/src/components/Player/VideoLyricsOverlay.tsx

import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { Box, Typography } from '@mui/material';
import { RootState } from '../../store';
import type { LyricsLine } from '../../types/lyrics.types';

interface VideoLyricsOverlayProps {
  translation?: Record<number, string>; // index → translated text
}

export default function VideoLyricsOverlay({ translation }: VideoLyricsOverlayProps) {
  const { currentTime } = useSelector((state: RootState) => state.player);
  const { currentLyrics, timeOffset } = useSelector((state: RootState) => state.lyrics);

  const lines: LyricsLine[] = currentLyrics?.lines || [];
  const isSynced = currentLyrics?.isSynced ?? false;

  // Find current line index based on adjusted time
  const currentLineIndex = useMemo(() => {
    if (!isSynced || lines.length === 0) return -1;
    const adjustedTime = currentTime + (timeOffset || 0);
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= adjustedTime) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [currentTime, timeOffset, lines, isSynced]);

  if (!isSynced || currentLineIndex < 0) return null;

  const currentLine = lines[currentLineIndex];
  if (!currentLine?.text?.trim()) return null;

  const translatedText = translation?.[currentLineIndex];

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 24,
        left: 16,
        right: 16,
        textAlign: 'center',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      <Typography
        sx={{
          color: '#fff',
          fontSize: '1.1rem',
          fontWeight: 600,
          textShadow: '0 0 8px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.8)',
          lineHeight: 1.4,
          px: 1,
        }}
      >
        {currentLine.text}
      </Typography>
      {translatedText && (
        <Typography
          sx={{
            color: 'rgba(255,255,255,0.85)',
            fontSize: '0.85rem',
            fontWeight: 400,
            textShadow: '0 0 6px rgba(0,0,0,0.8), 0 1px 3px rgba(0,0,0,0.7)',
            lineHeight: 1.3,
            mt: 0.3,
            px: 1,
          }}
        >
          {translatedText}
        </Typography>
      )}
    </Box>
  );
}
```

- [ ] **Step 7.2: Add overlay to FullscreenLyrics video section**

In `FullscreenLyrics.tsx`, import the overlay:

```typescript
import VideoLyricsOverlay from './VideoLyricsOverlay';
```

Find the `renderVideo()` function. Inside the video container (the Box that wraps the `<video>` element), add the overlay as a sibling of the video element. The parent Box needs `position: 'relative'` (it likely already has it for the video sizing):

```typescript
{viewMode === 'video' && videoCached && (
  <>
    <video ref={cachedVideoRef} /* existing props */ />
    <VideoLyricsOverlay translation={translationMap} />
  </>
)}
```

The `translationMap` should be the existing translation data from FullscreenLyrics state. Check how translations are stored — likely as an array or object keyed by line index. Pass whatever format is available; adjust the overlay component's props to match.

- [ ] **Step 7.3: Verify TypeScript compiles**

Run: `cd D:/Projects/_HomeProject/home-media/frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors

- [ ] **Step 7.4: Commit**

```bash
git add frontend/src/components/Player/VideoLyricsOverlay.tsx frontend/src/components/Player/FullscreenLyrics.tsx
git commit -m "feat: add lyrics overlay on video tab — shows current line + translation"
```

---

## Task 8: Video Download Resilience

**Files:**
- Modify: `frontend/src/components/Player/FullscreenLyrics.tsx`

Add retry logic for video download failures and better error state.

- [ ] **Step 8.1: Add retry with backoff for video download**

In `FullscreenLyrics.tsx`, find the video cache polling effect (starts around line 193 with `if (!open || !track?.videoId || viewMode !== 'video') return`).

Wrap the download trigger with retry logic:

```typescript
    let downloadRetries = 0;
    const MAX_DOWNLOAD_RETRIES = 3;
    const RETRY_DELAYS = [2000, 5000, 10000];

    const triggerDownload = async () => {
      try {
        await apiService.downloadVideo(track.videoId);
      } catch (err) {
        downloadRetries++;
        if (downloadRetries <= MAX_DOWNLOAD_RETRIES) {
          const delay = RETRY_DELAYS[downloadRetries - 1] || 10000;
          console.warn(`🎬 Video download failed (attempt ${downloadRetries}), retrying in ${delay}ms`);
          setTimeout(triggerDownload, delay);
        } else {
          console.error(`🎬 Video download failed after ${MAX_DOWNLOAD_RETRIES} retries`);
          setVideoDownloading(false);
          // Could set an error state here for UI feedback
        }
      }
    };
```

Replace the existing `apiService.downloadVideo(videoId).catch(() => {})` call with `triggerDownload()`.

- [ ] **Step 8.2: Commit**

```bash
git add frontend/src/components/Player/FullscreenLyrics.tsx
git commit -m "fix: add retry with backoff for video download failures"
```

---

## Task 9: Final Integration Test & Cleanup

**Files:**
- Modify: `frontend/src/components/Player/AudioPlayer.tsx` (cleanup)

- [ ] **Step 9.1: Verify full TypeScript compilation**

Run: `cd D:/Projects/_HomeProject/home-media/frontend && npx tsc --noEmit 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 9.2: Verify dev server starts**

Run: `cd D:/Projects/_HomeProject/home-media/frontend && timeout 15 npx vite --host 2>&1 | head -20`
Expected: Vite dev server starts successfully

- [ ] **Step 9.3: Update CLAUDE.md with new patterns**

Add to the `Things That Break Easily` section in CLAUDE.md:

```markdown
- **Playback state persistence**: `playback-state.service.ts` saves to localStorage every 5s + on visibilitychange. Recovery seek uses `consumeRecoverySeekTarget()` (one-shot). Don't call `restore()` after `clear()` in the same flow.
- **Video lyrics overlay**: `VideoLyricsOverlay` reads Redux `currentTime` + `lyrics` state. It's `pointerEvents: 'none'` — don't add click handlers to it.
- **iOS PWA memory**: cached `<video>` element is conditionally rendered only in video tab. `cachedVideoRef.current` may be null — always null-check.
```

- [ ] **Step 9.4: Final commit**

```bash
git add -A
git commit -m "docs: update CLAUDE.md with persistence and video overlay patterns"
```

---

## Summary of Changes

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Auto-next fails on lock screen | iOS kills PWA process, all JS state lost | Persist state to localStorage, auto-restore on reload |
| Black screen on unlock | PWA process killed + reloaded | Crash recovery restores playlist + position |
| Video iframe A/V sync >1s | 2s drift tolerance too loose | 1s hard seek + playbackRate nudge for 0.3-1s |
| Cached video sync drift | 0.9s hard seek threshold | 0.7s threshold + tighter playbackRate 0.96-1.04 |
| No lyrics on video tab | Feature not implemented | VideoLyricsOverlay component |
| Video download failures | No retry logic | 3 retries with exponential backoff |
| High memory → iOS kills PWA | Video DOM always mounted | Conditional render, skip timers in background |

## What This Does NOT Fix

- **iOS may still kill the PWA** — this is an OS-level decision we cannot prevent, only mitigate (less memory) and recover from (persistence)
- **The continuous player (`useContinuousPlayer`)** is still available as an opt-in mode for users who want zero-gap server-side concatenation. This plan doesn't change it.
- **Gap between tracks on recovery** — when iOS kills and reloads the PWA, there will be a brief silence while the app loads. This is unavoidable without a native app.
