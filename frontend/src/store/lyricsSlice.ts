import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Lyrics } from '../types/lyrics.types';

interface LyricsState {
  currentLyrics: Lyrics | null;
  isLoading: boolean;
  error: string | null;
  currentLineIndex: number; // 當前高亮的歌詞行索引
  timeOffset: number; // 歌詞時間偏移（秒），正數表示歌詞提前，負數表示歌詞延後
}

const initialState: LyricsState = {
  currentLyrics: null,
  isLoading: false,
  error: null,
  currentLineIndex: -1,
  timeOffset: 0,
};

const lyricsSlice = createSlice({
  name: 'lyrics',
  initialState,
  reducers: {
    setCurrentLyrics(state, action: PayloadAction<Lyrics | null>) {
      state.currentLyrics = action.payload;
      state.currentLineIndex = -1;
      state.error = null;
    },
    setIsLoading(state, action: PayloadAction<boolean>) {
      state.isLoading = action.payload;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
      state.isLoading = false;
    },
    setCurrentLineIndex(state, action: PayloadAction<number>) {
      state.currentLineIndex = action.payload;
    },
    clearLyrics(state) {
      state.currentLyrics = null;
      state.currentLineIndex = -1;
      state.error = null;
      state.isLoading = false;
      state.timeOffset = 0;
    },
    setTimeOffset(state, action: PayloadAction<number>) {
      state.timeOffset = action.payload;
    },
    adjustTimeOffset(state, action: PayloadAction<number>) {
      // 調整偏移，限制在 ±10 秒範圍內
      state.timeOffset = Math.max(-10, Math.min(10, state.timeOffset + action.payload));
    },
    resetTimeOffset(state) {
      state.timeOffset = 0;
    },
  },
});

export const {
  setCurrentLyrics,
  setIsLoading,
  setError,
  setCurrentLineIndex,
  clearLyrics,
  setTimeOffset,
  adjustTimeOffset,
  resetTimeOffset,
} = lyricsSlice.actions;

export default lyricsSlice.reducer;
