import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../store';
import { socketService } from '../services/socket.service';
import type { RadioTrack } from '../services/socket.service';
import { setPendingTrack, setIsPlaying, seekTo } from '../store/playerSlice';
import {
  setStations,
  setHostStation,
  setListenerCount,
  joinStation,
  leaveStation,
  stationClosed,
  syncState,
} from '../store/radioSlice';

/**
 * 電台同步 Hook
 * - 主播：自動同步播放狀態給聽眾
 * - 聽眾：自動跟隨主播的播放狀態
 */
export function useRadioSync() {
  const dispatch = useDispatch();
  const { currentTrack, isPlaying, currentTime, isLoadingTrack } = useSelector(
    (state: RootState) => state.player
  );
  const { isHost, isListener, syncTrack, syncTime, syncIsPlaying } = useSelector(
    (state: RootState) => state.radio
  );

  // 追蹤上一次的值
  const prevTrackRef = useRef<string | null>(null);
  const prevIsPlayingRef = useRef<boolean>(false);
  const timeSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 聽眾同步防抖：避免連續 seek 導致跳針
  const lastSyncTimeRef = useRef<number>(0);
  const syncCooldownMs = 5000; // 同步後 5 秒內不再同步

  // 設定電台回調（在連線後執行）
  useEffect(() => {
    socketService.setCallbacks({
      onRadioList: (stations) => {
        dispatch(setStations(stations));
      },
      onRadioCreated: (data) => {
        dispatch(setHostStation(data));
      },
      onRadioJoined: (data) => {
        dispatch(joinStation(data));
      },
      onRadioSync: (data) => {
        dispatch(syncState(data));
      },
      onRadioClosed: () => {
        dispatch(stationClosed());
      },
      onRadioListenerJoined: (data) => {
        dispatch(setListenerCount(data.listenerCount));
      },
      onRadioListenerLeft: (data) => {
        dispatch(setListenerCount(data.listenerCount));
      },
      onRadioLeft: () => {
        dispatch(leaveStation());
      },
      onRadioError: (data) => {
        console.error('Radio error:', data.message);
      },
    });
  }, [dispatch]);

  // ===== 主播同步邏輯 =====

  // 同步曲目變更
  useEffect(() => {
    if (!isHost) return;

    const currentVideoId = currentTrack?.videoId || null;
    if (currentVideoId !== prevTrackRef.current) {
      prevTrackRef.current = currentVideoId;

      if (currentTrack) {
        const radioTrack: RadioTrack = {
          videoId: currentTrack.videoId,
          title: currentTrack.title,
          channel: currentTrack.channel,
          thumbnail: currentTrack.thumbnail,
          duration: currentTrack.duration,
        };
        socketService.radioTrackChange(radioTrack);
        console.log('📻 [Host] Track changed:', currentTrack.title);
      } else {
        socketService.radioTrackChange(null);
        console.log('📻 [Host] Track cleared');
      }
    }
  }, [isHost, currentTrack]);

  // 同步播放狀態
  useEffect(() => {
    if (!isHost) return;

    if (isPlaying !== prevIsPlayingRef.current) {
      prevIsPlayingRef.current = isPlaying;
      socketService.radioPlayState(isPlaying, currentTime);
      console.log('📻 [Host] Play state:', isPlaying);
    }
  }, [isHost, isPlaying, currentTime]);

  // 定期時間同步（每 5 秒）
  useEffect(() => {
    if (!isHost || !isPlaying) {
      if (timeSyncIntervalRef.current) {
        clearInterval(timeSyncIntervalRef.current);
        timeSyncIntervalRef.current = null;
      }
      return;
    }

    timeSyncIntervalRef.current = setInterval(() => {
      socketService.radioTimeSync(currentTime);
    }, 5000);

    return () => {
      if (timeSyncIntervalRef.current) {
        clearInterval(timeSyncIntervalRef.current);
        timeSyncIntervalRef.current = null;
      }
    };
  }, [isHost, isPlaying, currentTime]);

  // 主播 seek 同步
  const hostSeek = useCallback((time: number) => {
    if (isHost) {
      socketService.radioSeek(time);
      console.log('📻 [Host] Seek to:', time);
    }
  }, [isHost]);

  // ===== 聽眾同步邏輯 =====

  // 當收到新曲目時，播放該曲目
  useEffect(() => {
    if (!isListener || !syncTrack) return;

    // 如果當前播放的曲目和同步曲目不同，切換曲目
    if (currentTrack?.videoId !== syncTrack.videoId) {
      console.log('📻 [Listener] Switching to track:', syncTrack.title);
      // 重置同步冷卻，允許新曲目立即同步時間
      lastSyncTimeRef.current = 0;
      dispatch(setPendingTrack({
        id: syncTrack.videoId,
        videoId: syncTrack.videoId,
        title: syncTrack.title,
        channel: syncTrack.channel,
        thumbnail: syncTrack.thumbnail,
        duration: syncTrack.duration,
      }));
    }
  }, [isListener, syncTrack, currentTrack, dispatch]);

  // 當收到播放狀態變更時
  useEffect(() => {
    if (!isListener) return;

    dispatch(setIsPlaying(syncIsPlaying));
  }, [isListener, syncIsPlaying, dispatch]);

  // 當收到 seek/time-sync 時
  useEffect(() => {
    if (!isListener || syncTime === undefined) return;

    // 如果正在載入曲目，不進行時間同步（避免跳針）
    if (isLoadingTrack) {
      console.log('📻 [Listener] Skipping time sync - track is loading');
      return;
    }

    // 檢查同步冷卻時間（避免連續 seek 導致跳針）
    const now = Date.now();
    if (now - lastSyncTimeRef.current < syncCooldownMs) {
      return;
    }

    // 如果時間差超過 3 秒，才進行同步
    const timeDiff = Math.abs(currentTime - syncTime);
    if (timeDiff > 3) {
      console.log('📻 [Listener] Syncing time:', syncTime, '(diff:', timeDiff, ')');
      lastSyncTimeRef.current = now;
      dispatch(seekTo(syncTime));
    }
  }, [isListener, syncTime, currentTime, isLoadingTrack, dispatch]);

  return {
    isHost,
    isListener,
    hostSeek,
  };
}
