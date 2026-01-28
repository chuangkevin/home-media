import { useEffect, useCallback } from 'react';
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
} from '../store/radioSlice';

export function useRadio() {
  const dispatch = useDispatch();
  const radioState = useSelector((state: RootState) => state.radio);

  useEffect(() => {
    // 設定電台回調
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

    // 初始發現電台
    socketService.discoverRadioStations();
  }, [dispatch]);

  // 建立電台
  const createStation = useCallback((stationName?: string, djName?: string) => {
    socketService.createRadioStation(stationName, djName);
  }, []);

  // 關閉電台
  const closeStation = useCallback(() => {
    socketService.closeRadioStation();
    dispatch(closeHostStation());
  }, [dispatch]);

  // 加入電台
  const joinRadio = useCallback((stationId: string) => {
    socketService.joinRadioStation(stationId);
  }, []);

  // 離開電台
  const leaveRadio = useCallback(() => {
    socketService.leaveRadioStation();
    dispatch(leaveStation());
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
