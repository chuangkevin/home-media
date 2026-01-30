import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../store';
import { socketService } from '../services/socket.service';
import type { RadioTrack } from '../services/socket.service';
import { setPendingTrack, setIsPlaying, seekTo, cancelPendingTrack, setDisplayMode } from '../store/playerSlice';
import {
  setStations,
  setHostStation,
  setListenerCount,
  joinStation,
  leaveStation,
  stationClosed,
  syncState,
} from '../store/radioSlice';

// ===== 常數配置 =====
const TIME_SYNC_INTERVAL_MS = 3000; // 主播時間同步間隔（3 秒）
const SYNC_COOLDOWN_MS = 3000; // 聽眾同步冷卻時間（3 秒）
const TIME_DIFF_THRESHOLD = 2; // 時間差閾值（2 秒才同步）
const LOAD_TIMEOUT_MS = 15000; // 聽眾載入超時（15 秒）

/**
 * 電台同步 Hook
 * - 主播：自動同步播放狀態給聽眾
 * - 聽眾：自動跟隨主播的播放狀態
 */
export function useRadioSync() {
  const dispatch = useDispatch();
  const { currentTrack, isPlaying, currentTime, isLoadingTrack, displayMode } = useSelector(
    (state: RootState) => state.player
  );
  const { isHost, isListener, syncTrack, syncTime, syncIsPlaying, syncDisplayMode } = useSelector(
    (state: RootState) => state.radio
  );

  // 追蹤上一次的值
  const prevTrackRef = useRef<string | null>(null);
  const prevIsPlayingRef = useRef<boolean>(false);
  const prevDisplayModeRef = useRef<string>(displayMode);
  const timeSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 聽眾同步防抖：避免連續 seek 導致跳針
  const lastSyncTimeRef = useRef<number>(0);

  // 聽眾載入超時計時器
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 追蹤上一次 isLoadingTrack 值（避免初始 false 誤觸清除邏輯）
  const prevIsLoadingTrackRef = useRef<boolean>(false);

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

  // 定期時間同步（每 3 秒）
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
    }, TIME_SYNC_INTERVAL_MS);

    return () => {
      if (timeSyncIntervalRef.current) {
        clearInterval(timeSyncIntervalRef.current);
        timeSyncIntervalRef.current = null;
      }
    };
  }, [isHost, isPlaying, currentTime]);

  // 同步顯示模式變更
  useEffect(() => {
    if (!isHost) return;

    if (displayMode !== prevDisplayModeRef.current) {
      prevDisplayModeRef.current = displayMode;
      socketService.radioDisplayMode(displayMode);
      console.log('📻 [Host] Display mode:', displayMode);
    }
  }, [isHost, displayMode]);

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

      // 清除舊的載入超時
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }

      // 設定載入超時
      loadTimeoutRef.current = setTimeout(() => {
        console.warn('📻 [Listener] Track load timeout, cancelling...');
        dispatch(cancelPendingTrack());
        // 通知使用者
        console.error('📻 [Listener] 曲目載入超時，請重新加入電台');
      }, LOAD_TIMEOUT_MS);

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

  // 載入完成時清除超時（僅在 isLoadingTrack 從 true 變為 false 時觸發）
  useEffect(() => {
    if (isListener && !isLoadingTrack && prevIsLoadingTrackRef.current && loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
      console.log('📻 [Listener] Track loaded successfully');
    }
    prevIsLoadingTrackRef.current = isLoadingTrack;
  }, [isListener, isLoadingTrack]);

  // 清理載入超時
  useEffect(() => {
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }
    };
  }, []);

  // 當收到播放狀態變更時
  useEffect(() => {
    if (!isListener) return;

    dispatch(setIsPlaying(syncIsPlaying));
  }, [isListener, syncIsPlaying, dispatch]);

  // 當收到顯示模式變更時
  useEffect(() => {
    if (!isListener) return;

    dispatch(setDisplayMode(syncDisplayMode));
    console.log('📻 [Listener] Display mode synced:', syncDisplayMode);
  }, [isListener, syncDisplayMode, dispatch]);

  // 當收到 seek/time-sync 時
  useEffect(() => {
    if (!isListener || syncTime === undefined) return;

    // 如果正在載入曲目，不進行時間同步（避免跳針）
    if (isLoadingTrack) {
      return;
    }

    // 檢查同步冷卻時間（避免連續 seek 導致跳針）
    const now = Date.now();
    if (now - lastSyncTimeRef.current < SYNC_COOLDOWN_MS) {
      return;
    }

    // 如果時間差超過閾值，才進行同步
    const timeDiff = Math.abs(currentTime - syncTime);
    if (timeDiff > TIME_DIFF_THRESHOLD) {
      console.log(`📻 [Listener] Syncing time: ${syncTime.toFixed(1)}s (diff: ${timeDiff.toFixed(1)}s)`);
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
