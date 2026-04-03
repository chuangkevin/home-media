/**
 * Crossfade Engine Hook
 *
 * Manages dual audio elements for smooth crossfade transitions in radio/DJ mode.
 * Uses element.volume for linear fade (NOT Web Audio API — CORS issues on mobile).
 */

import { useRef, useCallback, useEffect } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import type { Track } from '../types/track.types';
import audioCacheService from '../services/audio-cache.service';
import apiService from '../services/api.service';

const CROSSFADE_DURATION = 5; // seconds
const CROSSFADE_PRELOAD_LEAD = 5; // seconds before crossfade to preload
const CROSSFADE_INTERVAL_MS = 16; // ~60fps volume animation
const LOCALSTORAGE_KEY = 'radio-crossfade-enabled';

export interface CrossfadeState {
  isActive: boolean;
  /** The incoming track during crossfade */
  incomingTrack: Track | null;
}

interface UseCrossfadeOptions {
  primaryAudioRef: React.RefObject<HTMLAudioElement | null>;
  secondaryAudioRef: React.RefObject<HTMLAudioElement | null>;
  onCrossfadeComplete: (newTrack: Track) => void;
  onCrossfadePreloadStart?: (nextTrack: Track) => void;
  onCrossfadeStarted?: (nextTrack: Track, crossfadeDuration: number, elapsedMs: number) => void;
}

export function useCrossfade({
  primaryAudioRef,
  secondaryAudioRef,
  onCrossfadeComplete,
  onCrossfadeStarted,
}: UseCrossfadeOptions) {
  const { isHost, isListener } = useSelector((state: RootState) => state.radio);
  const { displayMode, playlist, currentIndex, volume } = useSelector(
    (state: RootState) => state.player
  );

  // Crossfade state refs
  const crossfadeActiveRef = useRef(false);
  const crossfadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const crossfadeStartTimeRef = useRef(0);
  const preloadedRef = useRef(false);
  const preloadedVideoIdRef = useRef<string | null>(null);
  const secondaryBlobUrlRef = useRef<string | null>(null);
  const incomingTrackRef = useRef<Track | null>(null);
  const warmedUpRef = useRef(false);
  const crossfadeEnabledRef = useRef(getCrossfadeEnabled());

  // Track volume ref for use in crossfade animation
  const volumeRef = useRef(volume);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  /** Check if crossfade is enabled from localStorage */
  function getCrossfadeEnabled(): boolean {
    try {
      return localStorage.getItem(LOCALSTORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  /** Set crossfade enabled in localStorage */
  const setCrossfadeEnabled = useCallback((enabled: boolean) => {
    try {
      localStorage.setItem(LOCALSTORAGE_KEY, String(enabled));
      crossfadeEnabledRef.current = enabled;
    } catch {
      // localStorage unavailable
    }
  }, []);

  /** Check if crossfade should be active (radio mode + enabled + not video) */
  const shouldCrossfade = useCallback((): boolean => {
    return (
      crossfadeEnabledRef.current &&
      (isHost || isListener) &&
      displayMode !== 'video'
    );
  }, [isHost, isListener, displayMode]);

  /** Warm up secondary audio element on first user interaction */
  const warmUpSecondary = useCallback(() => {
    if (warmedUpRef.current || !secondaryAudioRef.current) return;

    const audio = secondaryAudioRef.current;
    // Play a tiny silent audio to unlock autoplay
    const silentDataUri = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    audio.src = silentDataUri;
    audio.volume = 0;
    audio.play().then(() => {
      audio.pause();
      audio.src = '';
      warmedUpRef.current = true;
      console.log('🔊 [Crossfade] Secondary audio element warmed up');
    }).catch(() => {
      // Will retry on next interaction
    });
  }, [secondaryAudioRef]);

  /** Get the next track from playlist */
  const getNextTrack = useCallback((): Track | null => {
    const nextIdx = currentIndex + 1;
    if (nextIdx >= playlist.length) return null;
    return playlist[nextIdx];
  }, [currentIndex, playlist]);

  /** Preload next track onto secondary audio element */
  const preloadNextTrack = useCallback(async (nextTrack: Track): Promise<boolean> => {
    const secondary = secondaryAudioRef.current;
    if (!secondary) return false;

    const videoId = nextTrack.videoId;
    preloadedVideoIdRef.current = videoId;
    incomingTrackRef.current = nextTrack;

    try {
      // Try IndexedDB cache first
      const cached = await audioCacheService.get(videoId);
      if (cached) {
        const blobUrl = URL.createObjectURL(cached);
        if (secondaryBlobUrlRef.current) {
          URL.revokeObjectURL(secondaryBlobUrlRef.current);
        }
        secondaryBlobUrlRef.current = blobUrl;
        secondary.src = blobUrl;
        secondary.load();
        console.log(`🔊 [Crossfade] Preloaded from cache: ${nextTrack.title}`);
        return true;
      }

      // Fallback to streaming URL
      const streamUrl = apiService.getStreamUrl(videoId);
      secondary.src = streamUrl;
      secondary.load();
      console.log(`🔊 [Crossfade] Preloading from stream: ${nextTrack.title}`);
      return true;
    } catch (err) {
      console.warn('🔊 [Crossfade] Preload failed:', err);
      return false;
    }
  }, [secondaryAudioRef]);

  /** Start crossfade animation */
  const startCrossfade = useCallback((
    remainingDuration?: number,
    elapsedMs?: number,
  ): { nextTrack: Track | null; crossfadeDuration: number; elapsedMs: number } | null => {
    const primary = primaryAudioRef.current;
    const secondary = secondaryAudioRef.current;
    const incomingTrack = incomingTrackRef.current;

    if (!primary || !secondary || !incomingTrack) {
      console.warn('🔊 [Crossfade] Cannot start: missing elements or track');
      return null;
    }

    if (crossfadeActiveRef.current) {
      console.warn('🔊 [Crossfade] Already in progress, skipping');
      return null;
    }

    const totalDuration = remainingDuration ?? CROSSFADE_DURATION;
    const alreadyElapsed = elapsedMs ?? 0;
    const remainingMs = (totalDuration * 1000) - alreadyElapsed;

    if (remainingMs <= 0) {
      // Crossfade already finished, hard-switch
      return null;
    }

    crossfadeActiveRef.current = true;
    crossfadeStartTimeRef.current = Date.now() - alreadyElapsed;

    // Set initial volumes
    const userVolume = volumeRef.current;
    primary.volume = userVolume;
    secondary.volume = 0;

    // Start playing secondary
    secondary.play().catch((err) => {
      console.warn('🔊 [Crossfade] Secondary play failed:', err);
      // Fallback: hard switch
      cancelCrossfade();
      return;
    });

    console.log(`🔊 [Crossfade] Starting ${totalDuration}s crossfade (elapsed: ${alreadyElapsed}ms)`);

    // Volume animation interval
    crossfadeTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - crossfadeStartTimeRef.current;
      const progress = Math.min(elapsed / (totalDuration * 1000), 1);
      const userVol = volumeRef.current;

      if (primaryAudioRef.current) {
        primaryAudioRef.current.volume = userVol * (1 - progress);
      }
      if (secondaryAudioRef.current) {
        secondaryAudioRef.current.volume = userVol * progress;
      }

      if (progress >= 1) {
        completeCrossfade();
      }
    }, CROSSFADE_INTERVAL_MS);

    return {
      nextTrack: incomingTrack,
      crossfadeDuration: totalDuration,
      elapsedMs: alreadyElapsed,
    };
  }, [primaryAudioRef, secondaryAudioRef]);

  /** Complete crossfade: swap roles, clean up */
  const completeCrossfade = useCallback(() => {
    if (crossfadeTimerRef.current) {
      clearInterval(crossfadeTimerRef.current);
      crossfadeTimerRef.current = null;
    }

    const primary = primaryAudioRef.current;
    const secondary = secondaryAudioRef.current;
    const incomingTrack = incomingTrackRef.current;

    if (primary && secondary) {
      // Stop outgoing (primary)
      primary.pause();
      primary.src = '';

      // Set final volumes
      secondary.volume = volumeRef.current;

      // Swap the src/blob tracking (the actual ref swap is managed by AudioPlayer)
    }

    // Revoke old primary blob URL is handled by AudioPlayer

    crossfadeActiveRef.current = false;
    preloadedRef.current = false;
    preloadedVideoIdRef.current = null;

    if (incomingTrack) {
      console.log(`🔊 [Crossfade] Complete. Now playing: ${incomingTrack.title}`);
      onCrossfadeComplete(incomingTrack);
    }

    incomingTrackRef.current = null;
  }, [primaryAudioRef, secondaryAudioRef, onCrossfadeComplete]);

  /** Cancel crossfade (e.g., DJ skips during crossfade) */
  const cancelCrossfade = useCallback(() => {
    if (crossfadeTimerRef.current) {
      clearInterval(crossfadeTimerRef.current);
      crossfadeTimerRef.current = null;
    }

    const secondary = secondaryAudioRef.current;
    if (secondary) {
      secondary.pause();
      secondary.src = '';
    }

    if (secondaryBlobUrlRef.current) {
      URL.revokeObjectURL(secondaryBlobUrlRef.current);
      secondaryBlobUrlRef.current = null;
    }

    crossfadeActiveRef.current = false;
    preloadedRef.current = false;
    preloadedVideoIdRef.current = null;
    incomingTrackRef.current = null;

    console.log('🔊 [Crossfade] Cancelled');
  }, [secondaryAudioRef]);

  /**
   * Check time update and trigger preload/crossfade as needed.
   * Called from AudioPlayer's handleTimeUpdate.
   * Returns true if crossfade is handling track transition (skip normal ended handler).
   */
  const checkTimeForCrossfade = useCallback((
    currentTime: number,
    trackDuration: number,
  ): boolean => {
    if (!shouldCrossfade() || trackDuration <= 0) return false;

    // Short track guard: skip crossfade if track.duration < crossfadeDuration * 2
    if (trackDuration < CROSSFADE_DURATION * 2) return false;

    // Already in crossfade
    if (crossfadeActiveRef.current) return true;

    const timeToEnd = trackDuration - currentTime;

    // Preload phase: preload next track 5 seconds before crossfade starts
    const preloadTrigger = CROSSFADE_DURATION + CROSSFADE_PRELOAD_LEAD;
    if (timeToEnd <= preloadTrigger && !preloadedRef.current) {
      const nextTrack = getNextTrack();
      if (nextTrack) {
        preloadedRef.current = true;
        preloadNextTrack(nextTrack);
      }
    }

    // Crossfade trigger: start crossfade at track.duration - CROSSFADE_DURATION
    if (timeToEnd <= CROSSFADE_DURATION && preloadedRef.current && incomingTrackRef.current) {
      const result = startCrossfade();
      if (result && onCrossfadeStarted) {
        onCrossfadeStarted(result.nextTrack!, result.crossfadeDuration, result.elapsedMs);
      }
      return true;
    }

    return crossfadeActiveRef.current;
  }, [shouldCrossfade, getNextTrack, preloadNextTrack, startCrossfade, onCrossfadeStarted]);

  /**
   * Execute crossfade as a listener (received from host via socket).
   */
  const executeCrossfadeAsListener = useCallback(async (
    nextTrack: Track,
    crossfadeDuration: number,
    elapsedMs: number,
  ) => {
    // Cancel any ongoing crossfade
    if (crossfadeActiveRef.current) {
      cancelCrossfade();
    }

    // Preload the next track
    const preloaded = await preloadNextTrack(nextTrack);
    if (!preloaded) {
      console.warn('🔊 [Crossfade] Listener: preload failed, will hard-switch after remaining time');
      // Wait remaining time then hard-switch
      const remainingMs = (crossfadeDuration * 1000) - elapsedMs;
      if (remainingMs > 0) {
        setTimeout(() => {
          onCrossfadeComplete(nextTrack);
        }, remainingMs);
      } else {
        onCrossfadeComplete(nextTrack);
      }
      return;
    }

    // Wait for secondary to be ready
    const secondary = secondaryAudioRef.current;
    if (!secondary) return;

    const waitForReady = (): Promise<void> => {
      return new Promise((resolve) => {
        if (secondary.readyState >= 2) {
          resolve();
          return;
        }
        const timeout = setTimeout(resolve, 3000);
        secondary.addEventListener('canplay', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
    };

    await waitForReady();

    // Start crossfade with elapsed time adjustment
    startCrossfade(crossfadeDuration, elapsedMs);
  }, [secondaryAudioRef, cancelCrossfade, preloadNextTrack, startCrossfade, onCrossfadeComplete]);

  /** Reset preload state when track changes */
  const resetPreload = useCallback(() => {
    preloadedRef.current = false;
    preloadedVideoIdRef.current = null;
    incomingTrackRef.current = null;
    if (secondaryBlobUrlRef.current) {
      URL.revokeObjectURL(secondaryBlobUrlRef.current);
      secondaryBlobUrlRef.current = null;
    }
  }, []);

  /** Get the secondary blob URL (for cleanup by AudioPlayer after swap) */
  const getSecondaryBlobUrl = useCallback(() => secondaryBlobUrlRef.current, []);

  /** Clear secondary blob URL reference (after AudioPlayer takes ownership) */
  const clearSecondaryBlobUrl = useCallback(() => {
    secondaryBlobUrlRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (crossfadeTimerRef.current) {
        clearInterval(crossfadeTimerRef.current);
      }
      if (secondaryBlobUrlRef.current) {
        URL.revokeObjectURL(secondaryBlobUrlRef.current);
      }
    };
  }, []);

  return {
    // State
    crossfadeActiveRef,
    crossfadeEnabledRef,

    // Methods
    getCrossfadeEnabled,
    setCrossfadeEnabled,
    shouldCrossfade,
    warmUpSecondary,
    checkTimeForCrossfade,
    startCrossfade,
    cancelCrossfade,
    completeCrossfade,
    resetPreload,
    executeCrossfadeAsListener,
    preloadNextTrack,
    getSecondaryBlobUrl,
    clearSecondaryBlobUrl,

    // Constants
    CROSSFADE_DURATION,
  };
}
