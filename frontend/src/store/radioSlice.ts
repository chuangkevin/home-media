import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type DisplayMode = 'video' | 'visualizer';

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
  displayMode: DisplayMode;
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
  hostGracePeriod: number; // 主播離線寬限期倒計時（秒）
  // 同步播放狀態
  syncTrack: RadioTrack | null;
  syncPlaylist: RadioTrack[]; // DJ 完整播放清單（供聽眾預載）
  syncTime: number;
  syncIsPlaying: boolean;
  syncDisplayMode: DisplayMode;
  syncVersion: number; // 同步版本號，用於解決競態條件
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
  hostGracePeriod: 0,
  syncTrack: null,
  syncPlaylist: [],
  syncTime: 0,
  syncIsPlaying: false,
  syncDisplayMode: 'visualizer',
  syncVersion: 0,
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
        playlist?: RadioTrack[];
        currentTime: number;
        isPlaying: boolean;
        displayMode?: DisplayMode;
        syncVersion?: number;
      }>
    ) {
      state.isListener = true;
      state.currentStationId = action.payload.stationId;
      state.currentStationName = action.payload.stationName;
      state.hostName = action.payload.hostName;
      state.hostDisconnected = false;
      state.syncTrack = action.payload.currentTrack;
      state.syncPlaylist = action.payload.playlist ?? [];
      state.syncTime = action.payload.currentTime;
      state.syncIsPlaying = action.payload.isPlaying;
      state.syncDisplayMode = action.payload.displayMode ?? 'visualizer';
      state.syncVersion = action.payload.syncVersion ?? 0;
    },
    // 聽眾：離開電台
    leaveStation(state) {
      state.isListener = false;
      state.currentStationId = null;
      state.currentStationName = null;
      state.hostName = null;
      state.hostDisconnected = false;
      state.hostGracePeriod = 0;
      state.syncTrack = null;
      state.syncPlaylist = [];
      state.syncTime = 0;
      state.syncIsPlaying = false;
      state.syncDisplayMode = 'visualizer';
      state.syncVersion = 0;
    },
    // 聽眾：電台關閉
    stationClosed(state) {
      state.isListener = false;
      state.currentStationId = null;
      state.currentStationName = null;
      state.hostName = null;
      state.hostDisconnected = false;
      state.hostGracePeriod = 0;
      state.syncTrack = null;
      state.syncPlaylist = [];
      state.syncTime = 0;
      state.syncIsPlaying = false;
      state.syncDisplayMode = 'visualizer';
      state.syncVersion = 0;
    },
    // 聽眾：同步狀態
    syncState(
      state,
      action: PayloadAction<{
        type: 'track-change' | 'play-state' | 'time-sync' | 'seek' | 'display-mode' | 'playlist-update';
        track?: RadioTrack | null;
        playlist?: RadioTrack[];
        currentTime?: number;
        isPlaying?: boolean;
        displayMode?: DisplayMode;
        syncVersion?: number;
      }>
    ) {
      // 收到同步資料代表主播在線
      state.hostDisconnected = false;

      const { type, track, currentTime, isPlaying, syncVersion } = action.payload;

      // 檢查版本號，防止舊事件覆蓋新狀態
      if (syncVersion !== undefined && syncVersion < state.syncVersion) {
        console.log(`📻 [Radio] Ignoring outdated sync event (received: ${syncVersion}, current: ${state.syncVersion})`);
        return;
      }

      // 更新版本號
      if (syncVersion !== undefined) {
        state.syncVersion = syncVersion;
      }

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
        case 'display-mode':
          state.syncDisplayMode = action.payload.displayMode ?? state.syncDisplayMode;
          break;
        case 'playlist-update':
          state.syncPlaylist = action.payload.playlist ?? state.syncPlaylist;
          break;
      }
    },
    resetRadio(state) {
      Object.assign(state, initialState);
    },
    // 聽眾：主播暫時離線（含寬限期）
    setHostDisconnected(state, action: PayloadAction<{ disconnected: boolean; gracePeriod?: number }>) {
      state.hostDisconnected = action.payload.disconnected;
      state.hostGracePeriod = action.payload.gracePeriod ?? 0;
    },
    // 聽眾：更新寬限期倒計時
    updateGracePeriod(state, action: PayloadAction<number>) {
      state.hostGracePeriod = action.payload;
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
  updateGracePeriod,
} = radioSlice.actions;

export default radioSlice.reducer;
