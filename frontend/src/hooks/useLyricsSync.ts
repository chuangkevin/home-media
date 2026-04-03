import { useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../store';
import { setTimeOffset, setCurrentLyrics } from '../store/lyricsSlice';
import { socketService } from '../services/socket.service';
import apiService from '../services/api.service';
import lyricsCacheService from '../services/lyrics-cache.service';

/**
 * useLyricsSync — 統一管理歌詞 Socket.io emit + listen 邏輯
 *
 * - emitOffsetUpdate: 本地偏移調整後廣播
 * - emitSourceUpdate: 本地來源切換後廣播
 * - 自動監聽遠端偏移/來源變更，videoId 匹配時即時套用
 * - isRemoteUpdate flag 防止 re-emit 無限循環
 */
export function useLyricsSync(videoId: string | undefined) {
  const dispatch = useDispatch();
  const isRemoteUpdateRef = useRef(false);

  // Get current track info for lyrics reload
  const currentTrack = useSelector((state: RootState) => state.player.currentTrack);

  // Emit offset update (called by local user actions)
  const emitOffsetUpdate = useCallback(
    (vid: string, timeOffset: number) => {
      if (isRemoteUpdateRef.current) return; // skip if this was triggered by a remote update
      socketService.emitLyricsOffsetUpdate(vid, timeOffset);
    },
    []
  );

  // Emit source update (called by local user actions)
  const emitSourceUpdate = useCallback(
    (vid: string, source: string, sourceId: number | string | null) => {
      if (isRemoteUpdateRef.current) return;
      socketService.emitLyricsSourceUpdate(vid, source, sourceId);
    },
    []
  );

  // Listen for remote changes
  useEffect(() => {
    if (!videoId) return;

    const handleOffsetChanged = (data: { videoId: string; timeOffset: number; deviceId: string }) => {
      if (data.videoId !== videoId) return; // different song, ignore

      // Apply remote offset — set flag to prevent re-emit
      isRemoteUpdateRef.current = true;
      dispatch(setTimeOffset(data.timeOffset));
      lyricsCacheService.setTimeOffset(data.videoId, data.timeOffset);
      console.log(`[LyricsSync] Remote offset applied: ${data.timeOffset}s for ${data.videoId}`);
      // Reset flag after microtask to ensure any synchronous side effects are skipped
      Promise.resolve().then(() => {
        isRemoteUpdateRef.current = false;
      });
    };

    const handleSourceChanged = async (data: { videoId: string; source: string; sourceId: number | string | null; deviceId: string }) => {
      if (data.videoId !== videoId) return; // different song, ignore

      isRemoteUpdateRef.current = true;
      console.log(`[LyricsSync] Remote source changed: ${data.source} (id=${data.sourceId}) for ${data.videoId}`);

      try {
        // Reload lyrics from backend (which already has the updated preference)
        const title = currentTrack?.title || '';
        const artist = currentTrack?.channel || '';
        const lyrics = await apiService.getLyrics(data.videoId, title, artist);

        if (lyrics) {
          await lyricsCacheService.set(data.videoId, lyrics);
          dispatch(setCurrentLyrics(lyrics));
        }
      } catch (error) {
        console.error('[LyricsSync] Failed to reload lyrics after remote source change:', error);
      } finally {
        isRemoteUpdateRef.current = false;
      }
    };

    socketService.onLyricsOffsetChanged(handleOffsetChanged);
    socketService.onLyricsSourceChanged(handleSourceChanged);

    return () => {
      socketService.offLyricsOffsetChanged(handleOffsetChanged);
      socketService.offLyricsSourceChanged(handleSourceChanged);
    };
  }, [videoId, dispatch, currentTrack?.title, currentTrack?.channel]);

  return { emitOffsetUpdate, emitSourceUpdate, isRemoteUpdateRef };
}
