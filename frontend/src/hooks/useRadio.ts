import { useEffect, useCallback, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../store';
import { socketService } from '../services/socket.service';
import type { RadioTrack } from '../services/socket.service';
import {
  setStations,
  setHostStation,
  setListenerCount,
  closeHostStation,
  joinStation,
  leaveStation,
  stationClosed,
  syncState,
  setHostDisconnected,
  updateGracePeriod,
} from '../store/radioSlice';

// localStorage key for tracking host status
const RADIO_HOST_KEY = 'radio_was_host';

export function useRadio() {
  const dispatch = useDispatch();
  const radioState = useSelector((state: RootState) => state.radio);
  const hasCheckedPending = useRef(false);
  const gracePeriodTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // 設定電台回調
    socketService.setCallbacks({
      onRadioList: (stations) => {
        dispatch(setStations(stations));
      },
      onRadioCreated: (data) => {
        dispatch(setHostStation(data));
        // 記錄主播狀態
        localStorage.setItem(RADIO_HOST_KEY, 'true');
        if (data.reclaimed) {
          console.log('📻 電台已重新接管:', data.stationName);
        }
      },
      onRadioJoined: (data) => {
        dispatch(joinStation(data));
      },
      onRadioSync: (data) => {
        dispatch(syncState(data));
        // 收到同步資料表示主播已重連，清除倒計時
        if (gracePeriodTimerRef.current) {
          clearInterval(gracePeriodTimerRef.current);
          gracePeriodTimerRef.current = null;
        }
      },
      onRadioClosed: () => {
        dispatch(stationClosed());
        localStorage.removeItem(RADIO_HOST_KEY);
        // 清除倒計時
        if (gracePeriodTimerRef.current) {
          clearInterval(gracePeriodTimerRef.current);
          gracePeriodTimerRef.current = null;
        }
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
      onRadioPendingStation: (data) => {
        if (data) {
          console.log('📻 發現待接管電台:', data.stationName);
          // 自動嘗試接管
          socketService.createRadioStation(data.stationName);
        }
      },
      onRadioHostDisconnected: (data) => {
        console.log('📻 主播暫時離線，電台將在', data.gracePeriod, '秒後關閉');
        dispatch(setHostDisconnected({ disconnected: true, gracePeriod: data.gracePeriod }));

        // 清除舊的計時器
        if (gracePeriodTimerRef.current) {
          clearInterval(gracePeriodTimerRef.current);
        }

        // 開始倒計時
        let remaining = data.gracePeriod;
        gracePeriodTimerRef.current = setInterval(() => {
          remaining--;
          if (remaining <= 0) {
            if (gracePeriodTimerRef.current) {
              clearInterval(gracePeriodTimerRef.current);
              gracePeriodTimerRef.current = null;
            }
          } else {
            dispatch(updateGracePeriod(remaining));
          }
        }, 1000);
      },
    });

    // 初始發現電台
    socketService.discoverRadioStations();

    // 檢查是否有待接管的電台（只在第一次掛載時檢查）
    if (!hasCheckedPending.current) {
      hasCheckedPending.current = true;
      const wasHost = localStorage.getItem(RADIO_HOST_KEY);
      if (wasHost === 'true') {
        console.log('📻 檢查是否有待接管的電台...');
        // 延遲一點確保 socket 已連接
        setTimeout(() => {
          socketService.checkPendingStation();
        }, 500);
      }
    }

    // 清理函數
    return () => {
      if (gracePeriodTimerRef.current) {
        clearInterval(gracePeriodTimerRef.current);
        gracePeriodTimerRef.current = null;
      }
    };
  }, [dispatch]);

  // 建立電台
  const createStation = useCallback((stationName?: string, djName?: string) => {
    socketService.createRadioStation(stationName, djName);
  }, []);

  // 關閉電台
  const closeStation = useCallback(() => {
    socketService.closeRadioStation();
    dispatch(closeHostStation());
    localStorage.removeItem(RADIO_HOST_KEY);
  }, [dispatch]);

  // 加入電台
  const joinRadio = useCallback((stationId: string) => {
    socketService.joinRadioStation(stationId);
  }, []);

  // 離開電台
  const leaveRadio = useCallback(() => {
    socketService.leaveRadioStation();
    dispatch(leaveStation());
    // 清除倒計時
    if (gracePeriodTimerRef.current) {
      clearInterval(gracePeriodTimerRef.current);
      gracePeriodTimerRef.current = null;
    }
  }, [dispatch]);

  // 重新發現電台
  const refreshStations = useCallback(() => {
    socketService.discoverRadioStations();
  }, []);

  // 主播：同步曲目變更
  const syncTrackChange = useCallback((track: RadioTrack | null) => {
    socketService.radioTrackChange(track);
  }, []);

  // 主播：同步播放狀態
  const syncPlayState = useCallback((isPlaying: boolean, currentTime: number) => {
    socketService.radioPlayState(isPlaying, currentTime);
  }, []);

  // 主播：同步時間
  const syncTime = useCallback((currentTime: number) => {
    socketService.radioTimeSync(currentTime);
  }, []);

  // 主播：同步 seek
  const syncSeek = useCallback((currentTime: number) => {
    socketService.radioSeek(currentTime);
  }, []);

  return {
    ...radioState,
    createStation,
    closeStation,
    joinRadio,
    leaveRadio,
    refreshStations,
    syncTrackChange,
    syncPlayState,
    syncTime,
    syncSeek,
  };
}
