import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface Track {
  id: string;
  videoId: string;
  title: string;
  artist?: string;
  duration: number;
  thumbnail?: string;
}

interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  queue: Track[];
  repeat: 'none' | 'one' | 'all';
  shuffle: boolean;
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
} = playerSlice.actions;

export default playerSlice.reducer;
