import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Track } from '../types/track.types';

export type DisplayMode = 'video' | 'lyrics' | 'visualizer';

interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  queue: Track[];
  repeat: 'none' | 'one' | 'all';
  shuffle: boolean;
  displayMode: DisplayMode;
  seekTarget: number | null; // 用於手動 seek 操作
}

const initialState: PlayerState = {
  currentTrack: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  queue: [],
  repeat: 'none',
  shuffle: false,
  displayMode: 'lyrics', // 預設顯示歌詞模式
  seekTarget: null,
};

const playerSlice = createSlice({
  name: 'player',
  initialState,
  reducers: {
    setCurrentTrack(state, action: PayloadAction<Track | null>) {
      state.currentTrack = action.payload;
      state.currentTime = 0;
    },
    setIsPlaying(state, action: PayloadAction<boolean>) {
      state.isPlaying = action.payload;
    },
    setCurrentTime(state, action: PayloadAction<number>) {
      state.currentTime = action.payload;
    },
    setDuration(state, action: PayloadAction<number>) {
      state.duration = action.payload;
    },
    setVolume(state, action: PayloadAction<number>) {
      state.volume = Math.max(0, Math.min(1, action.payload));
    },
    setQueue(state, action: PayloadAction<Track[]>) {
      state.queue = action.payload;
    },
    addToQueue(state, action: PayloadAction<Track>) {
      state.queue.push(action.payload);
    },
    removeFromQueue(state, action: PayloadAction<string>) {
      state.queue = state.queue.filter(track => track.id !== action.payload);
    },
    setRepeat(state, action: PayloadAction<'none' | 'one' | 'all'>) {
      state.repeat = action.payload;
    },
    setShuffle(state, action: PayloadAction<boolean>) {
      state.shuffle = action.payload;
    },
    setDisplayMode(state, action: PayloadAction<DisplayMode>) {
      state.displayMode = action.payload;
    },
    seekTo(state, action: PayloadAction<number>) {
      state.seekTarget = action.payload;
      state.currentTime = action.payload;
    },
    clearSeekTarget(state) {
      state.seekTarget = null;
    },
  },
});

export const {
  setCurrentTrack,
  setIsPlaying,
  setCurrentTime,
  setDuration,
  setVolume,
  setQueue,
  addToQueue,
  removeFromQueue,
  setRepeat,
  setShuffle,
  setDisplayMode,
  seekTo,
  clearSeekTarget,
} = playerSlice.actions;

export default playerSlice.reducer;
