import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface RadioTrack {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
}

export interface RadioStation {
  id: string;
  hostName: string;
  stationName: string;
  listenerCount: number;
  currentTrack: RadioTrack | null;
  isPlaying: boolean;
}

interface RadioState {
  // 電台列表
  stations: RadioStation[];
  // 主播狀態
  isHost: boolean;
  myStationId: string | null;
  myStationName: string | null;
  listenerCount: number;
  // 聽眾狀態
  isListener: boolean;
  currentStationId: string | null;
  currentStationName: string | null;
  hostName: string | null;
  hostDisconnected: boolean; // 主播暫時離線
  // 同步播放狀態
  syncTrack: RadioTrack | null;
  syncTime: number;
  syncIsPlaying: boolean;
}

const initialState: RadioState = {
  stations: [],
  isHost: false,
  myStationId: null,
  myStationName: null,
  listenerCount: 0,
  isListener: false,
  currentStationId: null,
  currentStationName: null,
  hostName: null,
  hostDisconnected: false,
  syncTrack: null,
  syncTime: 0,
  syncIsPlaying: false,
};

const radioSlice = createSlice({
  name: 'radio',
  initialState,
  reducers: {
    setStations(state, action: PayloadAction<RadioStation[]>) {
      state.stations = action.payload;
    },
    // 主播：電台建立成功
    setHostStation(state, action: PayloadAction<{ stationId: string; stationName: string }>) {
      state.isHost = true;
      state.myStationId = action.payload.stationId;
      state.myStationName = action.payload.stationName;
      state.listenerCount = 0;
    },
    // 主播：更新聽眾數
    setListenerCount(state, action: PayloadAction<number>) {
      state.listenerCount = action.payload;
    },
    // 主播：關閉電台
    closeHostStation(state) {
      state.isHost = false;
      state.myStationId = null;
      state.myStationName = null;
      state.listenerCount = 0;
    },
    // 聽眾：加入電台
    joinStation(
      state,
      action: PayloadAction<{
        stationId: string;
        stationName: string;
        hostName: string;
        currentTrack: RadioTrack | null;
        currentTime: number;
        isPlaying: boolean;
      }>
    ) {
      state.isListener = true;
      state.currentStationId = action.payload.stationId;
      state.currentStationName = action.payload.stationName;
      state.hostName = action.payload.hostName;
      state.hostDisconnected = false;
      state.syncTrack = action.payload.currentTrack;
      state.syncTime = action.payload.currentTime;
      state.syncIsPlaying = action.payload.isPlaying;
    },
    // 聽眾：離開電台
    leaveStation(state) {
      state.isListener = false;
      state.currentStationId = null;
      state.currentStationName = null;
      state.hostName = null;
      state.syncTrack = null;
      state.syncTime = 0;
      state.syncIsPlaying = false;
    },
    // 聽眾：電台關閉
    stationClosed(state) {
      state.isListener = false;
      state.currentStationId = null;
      state.currentStationName = null;
      state.hostName = null;
      state.syncTrack = null;
      state.syncTime = 0;
      state.syncIsPlaying = false;
    },
    // 聽眾：同步狀態
    syncState(
      state,
      action: PayloadAction<{
        type: 'track-change' | 'play-state' | 'time-sync' | 'seek';
        track?: RadioTrack | null;
        currentTime?: number;
        isPlaying?: boolean;
      }>
    ) {
      // 收到同步資料代表主播在線
      state.hostDisconnected = false;

      const { type, track, currentTime, isPlaying } = action.payload;
      switch (type) {
        case 'track-change':
          state.syncTrack = track ?? null;
          state.syncTime = currentTime ?? 0;
          state.syncIsPlaying = isPlaying ?? true;
          break;
        case 'play-state':
          state.syncIsPlaying = isPlaying ?? state.syncIsPlaying;
          state.syncTime = currentTime ?? state.syncTime;
          break;
        case 'time-sync':
        case 'seek':
          state.syncTime = currentTime ?? state.syncTime;
          break;
      }
    },
    resetRadio(state) {
      Object.assign(state, initialState);
    },
    // 聽眾：主播暫時離線
    setHostDisconnected(state, action: PayloadAction<boolean>) {
      state.hostDisconnected = action.payload;
    },
  },
});

export const {
  setStations,
  setHostStation,
  setListenerCount,
  closeHostStation,
  joinStation,
  leaveStation,
  stationClosed,
  syncState,
  resetRadio,
  setHostDisconnected,
} = radioSlice.actions;

export default radioSlice.reducer;
