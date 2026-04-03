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
const SYNC_COOLDOWN_MS = 5000; // 聽眾同步冷卻時間（5 秒，給足緩衝時間）
const TIME_DIFF_THRESHOLD = 10; // 時間差閾值（10 秒才同步，避免打斷緩衝）
const LOAD_TIMEOUT_MS = 15000; // 聽眾載入超時（15 秒）
const POST_LOAD_GRACE_MS = 5000; // 載入完成後的靜默期（5 秒，讓音訊完整緩衝）
const SEEK_COOLDOWN_MS = 8000; // seek 後的冷卻時間（8 秒，等待緩衝完成）

/**
 * 電台同步 Hook
 * - 主播：自動同步播放狀態給聽眾
 * - 聽眾：自動跟隨主播的播放狀態
 */
export function useRadioSync() {
  const dispatch = useDispatch();
  const { currentTrack, pendingTrack, isPlaying, currentTime, isLoadingTrack, displayMode } = useSelector(
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
  const lastSeekTimeRef = useRef<number>(0); // 記錄上次 seek 時間
  const hasPlayedRef = useRef<boolean>(false); // 追蹤是否已經開始播放過

  // 聽眾載入超時計時器
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 追蹤當前 syncTrack videoId（供 timeout closure 讀取最新值）
  const syncTrackVideoIdRef = useRef<string | null>(null);
  // 追蹤上一次 isLoadingTrack 值（避免初始 false 誤觸清除邏輯）
  const prevIsLoadingTrackRef = useRef<boolean>(false);
  // 載入完成後的靜默期時間戳
  const loadCompletedAtRef = useRef<number>(0);
  
  // 電台無活動檢測計時器
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const INACTIVITY_TIMEOUT = 30000; // 30 秒無活動自動離開

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
        console.log('📻 [Listener] Station closed by DJ');
        dispatch(stationClosed());
        
        // DJ 關閉電台，聽眾自動恢復本地播放
        if (isListener) {
          console.log('📻 [Listener] Auto-resuming local playback after station closed');
          // 如果有曲目但沒在播放，自動播放
          if (currentTrack && !isPlaying) {
            dispatch(setIsPlaying(true));
          }
        }
      },
      onRadioListenerJoined: (data) => {
        dispatch(setListenerCount(data.listenerCount));
      },
      onRadioListenerLeft: (data) => {
        dispatch(setListenerCount(data.listenerCount));
      },
      onRadioLeft: () => {
        console.log('📻 [Listener] Left station');
        dispatch(leaveStation());
        
        // 離開電台後，恢復本地播放
        if (currentTrack && !isPlaying) {
          console.log('📻 [Listener] Auto-resuming local playback after leaving');
          dispatch(setIsPlaying(true));
        }
      },
      onRadioError: (data) => {
        console.error('Radio error:', data.message);
      },
    });
  }, [dispatch]);

  // ===== 主播同步邏輯 =====

  // 同步曲目變更（使用 pendingTrack || currentTrack 避免轉場延遲）
  useEffect(() => {
    if (!isHost) return;

    // pendingTrack 在 playNow 時先設定，currentTrack 要等載入完成才更新
    // 用 pendingTrack 優先，讓聽眾立即開始載入新曲目
    const activeTrack = pendingTrack || currentTrack;
    const activeVideoId = activeTrack?.videoId || null;

    // 避免重複發送同一首曲目
    if (activeVideoId === prevTrackRef.current) return;

    // null guard：轉場期間 track 可能短暫為 null，不發送避免聽眾誤取消
    if (!activeTrack) return;

    prevTrackRef.current = activeVideoId;

    const radioTrack: RadioTrack = {
      videoId: activeTrack.videoId,
      title: activeTrack.title,
      channel: activeTrack.channel,
      thumbnail: activeTrack.thumbnail,
      duration: activeTrack.duration,
    };
    socketService.radioTrackChange(radioTrack);
    console.log('📻 [Host] Track changed:', activeTrack.title);
  }, [isHost, currentTrack, pendingTrack]);

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

    // 立即發送一次時間同步
    socketService.radioTimeSync(currentTime);
    console.log('📻 [Host] Starting time sync, initial time:', currentTime.toFixed(1));

    timeSyncIntervalRef.current = setInterval(() => {
      // 使用 audioElement 獲取實時時間，避免 stale closure
      const audioElement = document.querySelector('audio');
      const realTime = audioElement?.currentTime || 0;
      socketService.radioTimeSync(realTime);
      console.log('📻 [Host] Time sync:', realTime.toFixed(1));
    }, TIME_SYNC_INTERVAL_MS);

    return () => {
      if (timeSyncIntervalRef.current) {
        clearInterval(timeSyncIntervalRef.current);
        timeSyncIntervalRef.current = null;
      }
    };
  }, [isHost, isPlaying]); // 移除 currentTime 依賴，避免頻繁重建 interval

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

    // 更新 ref，讓 timeout closure 能讀到最新的 syncTrack videoId
    syncTrackVideoIdRef.current = syncTrack.videoId;

    // 如果當前播放的曲目和同步曲目不同，切換曲目
    if (currentTrack?.videoId !== syncTrack.videoId) {
      console.log('📻 [Listener] Switching to track:', syncTrack.title);
      // 設定冷卻為當前時間，載入完成後的靜默期會再保護一段時間
      lastSyncTimeRef.current = Date.now();

      // 清除舊的載入超時
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }

      // 設定載入超時 — 捕獲當前 syncTrack videoId，避免競態取消
      const expectedVideoId = syncTrack.videoId;
      loadTimeoutRef.current = setTimeout(() => {
        // 超時前檢查：如果 DJ 已經切到新曲目，不取消（新曲目有自己的 timeout）
        if (syncTrackVideoIdRef.current && syncTrackVideoIdRef.current !== expectedVideoId) {
          console.log('📻 [Listener] Timeout for old track, DJ already moved on — skipping cancel');
          return;
        }
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
    if (isListener && !isLoadingTrack && prevIsLoadingTrackRef.current) {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
      // 記錄載入完成時間，給予靜默期避免立刻 seek 跳針
      const now = Date.now();
      loadCompletedAtRef.current = now;
      // 重置播放狀態標記（新曲目需要重新開始播放）
      hasPlayedRef.current = false;
      console.log('📻 [Listener] Track loaded successfully, grace period until', new Date(now + POST_LOAD_GRACE_MS).toLocaleTimeString());
      
      // 載入完成後，立即同步播放狀態（如果 DJ 正在播放，Listener 也要播放）
      dispatch(setIsPlaying(syncIsPlaying));
      console.log('📻 [Listener] Synced play state after load:', syncIsPlaying);
    }
    prevIsLoadingTrackRef.current = isLoadingTrack;
  }, [isListener, isLoadingTrack, syncIsPlaying, dispatch]);

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
    // 載入中不變更播放狀態，避免衝突
    if (isLoadingTrack) return;

    dispatch(setIsPlaying(syncIsPlaying));
  }, [isListener, syncIsPlaying, isLoadingTrack, dispatch]);

  // DJ 無活動監測 - 30秒無同步訊息則自動離開並恢復本地播放
  useEffect(() => {
    if (!isListener || !syncTrack) return;

    // 更新活動時間
    lastActivityRef.current = Date.now();

    // 清除舊的計時器
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }

    // 啟動新的計時器
    inactivityTimerRef.current = setTimeout(() => {
      console.warn('📻 [Listener] DJ inactive for 30s, auto-leaving station and resuming local playback...');
      socketService.leaveRadioStation();
      // 離開時會觸發 onRadioLeft 回調，自動恢復播放
    }, INACTIVITY_TIMEOUT);

    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [isListener, syncTrack, syncTime, syncIsPlaying]);

  // 當收到顯示模式變更時
  useEffect(() => {
    if (!isListener) return;
    // 載入中不切換顯示模式，避免觸發音訊重啟
    if (isLoadingTrack) return;

    dispatch(setDisplayMode(syncDisplayMode));
    console.log('📻 [Listener] Display mode synced:', syncDisplayMode);
  }, [isListener, syncDisplayMode, isLoadingTrack, dispatch]);

  // 當收到 seek/time-sync 時
  useEffect(() => {
    if (!isListener || syncTime === undefined) return;

    // 載入中不進行時間同步
    if (isLoadingTrack) return;

    const now = Date.now();
    const timeSinceLoad = now - loadCompletedAtRef.current;

    // 載入完成後的靜默期（避免剛載入完就被 seek 跳針）
    if (timeSinceLoad < POST_LOAD_GRACE_MS) {
      console.log(`📻 [Listener] Grace period active (${(timeSinceLoad / 1000).toFixed(1)}s / ${POST_LOAD_GRACE_MS / 1000}s), skipping sync`);
      return;
    }

    // 首次播放時，不進行同步，讓音訊自然開始播放
    // 只有在已經播放一段時間後才開始時間同步
    if (!hasPlayedRef.current && currentTime < 3) {
      // 如果已經播放超過 3 秒，標記為已播放
      if (currentTime > 0) {
        hasPlayedRef.current = true;
      }
      return;
    }

    // seek 後的冷卻時間（等待緩衝完成）
    if (now - lastSeekTimeRef.current < SEEK_COOLDOWN_MS) {
      console.log(`📻 [Listener] Seek cooldown active, skipping sync`);
      return;
    }

    // 同步冷卻時間
    if (now - lastSyncTimeRef.current < SYNC_COOLDOWN_MS) {
      return;
    }

    // 如果時間差超過閾值，才進行同步
    const timeDiff = Math.abs(currentTime - syncTime);
    if (timeDiff > TIME_DIFF_THRESHOLD) {
      console.log(`📻 [Listener] Syncing time: ${syncTime.toFixed(1)}s (diff: ${timeDiff.toFixed(1)}s)`);
      lastSyncTimeRef.current = now;
      lastSeekTimeRef.current = now; // 記錄 seek 時間
      dispatch(seekTo(syncTime));
    }
  }, [isListener, syncTime, currentTime, isLoadingTrack, dispatch]);

  return {
    isHost,
    isListener,
    hostSeek,
  };
}
