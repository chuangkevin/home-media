/**
 * useContinuousPlayer
 *
 * Server-Side Continuous Stream 模式。
 * 後端把播放清單串接成一條不間斷的 HTTP MP3 stream，前端 audio element 只有一個 src。
 * 歌曲切換在 server 端發生；前端透過 SSE 收到 track-change / lyrics / position 事件來更新 UI。
 *
 * iOS PWA 鎖螢幕後 timeupdate 事件停止，此模式可確保 audio element 永遠不停，
 * 解決自動播下一首失效的問題。
 *
 * 使用方式：在 AudioPlayer 內呼叫，傳入 audioRef。
 * 回傳 isSSEUpdateRef — AudioPlayer 的 pendingTrack effect 使用此 ref 區分
 * 「SSE 帶來的曲目切換」vs「使用者主動按下一首」。
 */

import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { MutableRefObject, RefObject } from 'react';
import { RootState } from '../store';
import { setEnabled, setSessionId, setConnected } from '../store/continuousPlayerSlice';
import {
  setPendingTrack,
  confirmPendingTrack,
  setIsPlaying,
  setCurrentTime,
  setDuration,
} from '../store/playerSlice';
import { setCurrentLyrics, setIsLoading as setLyricsLoading } from '../store/lyricsSlice';
import apiService from '../services/api.service';
import type { Track } from '../types/track.types';
import type { LyricsLine } from '../types/lyrics.types';

export interface ContinuousPlayerControls {
  /** AudioPlayer 的 pendingTrack effect 需要讀取此 ref 來區分 SSE update vs 使用者操作 */
  isSSEUpdateRef: MutableRefObject<boolean>;
  /** 啟用 / 停用 continuous mode（自動管理 session 生命周期） */
  toggle: () => void;
}

export function useContinuousPlayer(
  audioRef: RefObject<HTMLAudioElement>,
): ContinuousPlayerControls {
  const dispatch = useDispatch();
  const { isEnabled } = useSelector((state: RootState) => state.continuousPlayer);
  const { playlist, currentIndex, volume } = useSelector((state: RootState) => state.player);

  /** true = 下一個 pendingTrack 變化是來自 SSE，AudioPlayer 應直接 confirm 而不載入音訊 */
  const isSSEUpdateRef = useRef(false);

  /** SSE EventSource */
  const sseRef = useRef<EventSource | null>(null);

  /** 位置插值用：上一次 SSE position 的值與時間戳 */
  const lastPosRef = useRef(0);
  const lastPosTimestampRef = useRef(0);
  const posIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── 位置插值 ─────────────────────────────────────────────────────────────

  const startPosInterpolation = useCallback(() => {
    if (posIntervalRef.current) clearInterval(posIntervalRef.current);
    posIntervalRef.current = setInterval(() => {
      if (!lastPosTimestampRef.current) return;
      const elapsed = (Date.now() - lastPosTimestampRef.current) / 1000;
      const interpolated = lastPosRef.current + elapsed;
      dispatch(setCurrentTime(Math.round(interpolated * 10) / 10));
    }, 200);
  }, [dispatch]);

  const stopPosInterpolation = useCallback(() => {
    if (posIntervalRef.current) {
      clearInterval(posIntervalRef.current);
      posIntervalRef.current = null;
    }
  }, []);

  // ─── SSE event handler ────────────────────────────────────────────────────

  const handleSseMessage = useCallback((event: MessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'track-change': {
        const t = msg.track as {
          videoId: string; title: string; artist: string; thumbnail: string; duration: number;
        };
        const track: Track = {
          id: t.videoId,
          videoId: t.videoId,
          title: t.title,
          channel: t.artist,
          thumbnail: t.thumbnail,
          duration: t.duration,
        };
        // Mark as SSE update so AudioPlayer skips audio loading
        isSSEUpdateRef.current = true;
        dispatch(setPendingTrack(track));
        dispatch(confirmPendingTrack());
        dispatch(setDuration(t.duration || 0));
        dispatch(setIsPlaying(true));

        // Reset position interpolation for new track
        const startPos = typeof msg.position === 'number' ? msg.position : 0;
        lastPosRef.current = startPos;
        lastPosTimestampRef.current = Date.now();
        dispatch(setCurrentTime(startPos));

        // Update MediaSession
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: t.title,
            artist: t.artist,
            artwork: t.thumbnail
              ? [
                  { src: t.thumbnail, sizes: '96x96', type: 'image/jpeg' },
                  { src: t.thumbnail, sizes: '192x192', type: 'image/jpeg' },
                  { src: t.thumbnail, sizes: '512x512', type: 'image/jpeg' },
                ]
              : [],
          });
        }
        break;
      }

      case 'lyrics': {
        const lines = msg.data as LyricsLine[];
        if (lines?.length) {
          dispatch(setLyricsLoading(false));
          dispatch(setCurrentLyrics({
            videoId: msg.videoId || '',
            lines,
            source: 'lrclib',
            isSynced: lines.some(l => l.time > 0),
          }));
        }
        break;
      }

      case 'position': {
        const pos = typeof msg.currentTime === 'number' ? msg.currentTime : 0;
        const dur = typeof msg.duration === 'number' ? msg.duration : 0;
        lastPosRef.current = pos;
        lastPosTimestampRef.current = Date.now();
        if (dur > 0) dispatch(setDuration(dur));
        break;
      }

      case 'queue-empty': {
        dispatch(setIsPlaying(false));
        stopPosInterpolation();
        break;
      }

      case 'session-ended': {
        dispatch(setEnabled(false));
        stopPosInterpolation();
        break;
      }
    }
  }, [dispatch, stopPosInterpolation]);

  // ─── Session lifecycle ────────────────────────────────────────────────────

  useEffect(() => {
    if (!isEnabled) return;

    let active = true;
    let createdSessionId: string | null = null;

    const setup = async () => {
      try {
        const { sessionId: sid } = await apiService.createContinuousSession();
        if (!active) {
          // Cleaned up before session was ready; delete immediately
          apiService.deleteContinuousSession(sid).catch(() => {});
          return;
        }

        createdSessionId = sid;
        dispatch(setSessionId(sid));

        // Queue current playlist starting from currentIndex
        const startIdx = currentIndex >= 0 ? currentIndex : 0;
        const tracksToQueue = playlist.slice(startIdx).map(t => ({
          videoId: t.videoId,
          title: t.title,
          artist: t.channel,
          thumbnail: t.thumbnail,
          duration: t.duration,
        }));

        if (tracksToQueue.length > 0) {
          await apiService.queueContinuousTracks(sid, tracksToQueue);
        }

        // Set audio element src once
        if (audioRef.current) {
          audioRef.current.src = apiService.getContinuousStreamUrl(sid);
          audioRef.current.volume = volume;
          audioRef.current.play().catch(() => {});
        }

        // Connect SSE
        const sse = new EventSource(apiService.getContinuousEventsUrl(sid));
        sseRef.current = sse;

        sse.onopen = () => {
          dispatch(setConnected(true));
          startPosInterpolation();
        };
        sse.onmessage = handleSseMessage;
        sse.onerror = () => {
          dispatch(setConnected(false));
        };

        // MediaSession action handlers
        if ('mediaSession' in navigator) {
          navigator.mediaSession.setActionHandler('play', () => {
            audioRef.current?.play().catch(() => {});
            dispatch(setIsPlaying(true));
          });
          navigator.mediaSession.setActionHandler('pause', () => {
            audioRef.current?.pause();
            dispatch(setIsPlaying(false));
          });
          navigator.mediaSession.setActionHandler('nexttrack', () => {
            if (sid) apiService.continuousNext(sid).catch(() => {});
          });
          navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime !== undefined && sid) {
              apiService.continuousSeek(sid, details.seekTime).catch(() => {});
            }
          });
        }

      } catch (err) {
        console.error('[ContinuousPlayer] Setup failed:', err);
        if (active) dispatch(setEnabled(false));
      }
    };

    setup();

    return () => {
      active = false;
      stopPosInterpolation();

      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }

      if (createdSessionId) {
        apiService.deleteContinuousSession(createdSessionId).catch(() => {});
      }

      dispatch(setSessionId(null));
      dispatch(setConnected(false));

      // Clear MediaSession handlers
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.setActionHandler('play', null);
          navigator.mediaSession.setActionHandler('pause', null);
          navigator.mediaSession.setActionHandler('nexttrack', null);
          navigator.mediaSession.setActionHandler('seekto', null);
        } catch {}
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEnabled]);

  // ─── Toggle ───────────────────────────────────────────────────────────────

  const toggle = useCallback(() => {
    dispatch(setEnabled(!isEnabled));
  }, [dispatch, isEnabled]);

  return { isSSEUpdateRef, toggle };
}
