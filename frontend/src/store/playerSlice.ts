import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Track } from '../types/track.types';

export type DisplayMode = 'video' | 'lyrics' | 'visualizer';

interface PlayerState {
  currentTrack: Track | null;
  pendingTrack: Track | null; // 等待載入的曲目（UI 不切換直到載入完成）
  isLoadingTrack: boolean; // 是否正在載入新曲目
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  queue: Track[];
  repeat: 'none' | 'one' | 'all';
  shuffle: boolean;
  displayMode: DisplayMode;
  seekTarget: number | null; // 用於手動 seek 操作
  playlist: Track[]; // 當前播放列表（搜尋結果）
  currentIndex: number; // 當前播放的索引
}

const initialState: PlayerState = {
  currentTrack: null,
  pendingTrack: null,
  isLoadingTrack: false,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  queue: [],
  repeat: 'all', // 預設循環播放整個列表
  shuffle: false,
  displayMode: 'lyrics', // 預設顯示歌詞模式
  seekTarget: null,
  playlist: [],
  currentIndex: -1,
};

const playerSlice = createSlice({
  name: 'player',
  initialState,
  reducers: {
    setCurrentTrack(state, action: PayloadAction<Track | null>) {
      state.currentTrack = action.payload;
      state.currentTime = 0;

      // 更新當前索引
      if (action.payload && state.playlist.length > 0) {
        const index = state.playlist.findIndex(t => t.id === action.payload!.id);
        if (index !== -1) {
          state.currentIndex = index;
        }
      }
    },
    // 設置等待載入的曲目（不立即切換 UI）
    setPendingTrack(state, action: PayloadAction<Track | null>) {
      state.pendingTrack = action.payload;
      if (action.payload) {
        state.isLoadingTrack = true;
      }
    },
    setIsLoadingTrack(state, action: PayloadAction<boolean>) {
      state.isLoadingTrack = action.payload;
    },
    // 確認切換到 pending 曲目（載入完成後調用）
    confirmPendingTrack(state) {
      if (state.pendingTrack) {
        state.currentTrack = state.pendingTrack;
        state.currentTime = 0;
        state.pendingTrack = null;
        state.isLoadingTrack = false;

        // 更新當前索引
        if (state.playlist.length > 0) {
          const index = state.playlist.findIndex(t => t.id === state.currentTrack!.id);
          if (index !== -1) {
            state.currentIndex = index;
          }
        }
      }
    },
    // 取消等待載入
    cancelPendingTrack(state) {
      state.pendingTrack = null;
      state.isLoadingTrack = false;
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
    setPlaylist(state, action: PayloadAction<Track[]>) {
      state.playlist = action.payload;
    },
    playNext(state) {
      if (state.playlist.length === 0) return;

      if (state.repeat === 'one') {
        // 重複播放當前曲目，重置時間
        state.currentTime = 0;
        state.seekTarget = 0;
        return;
      }

      let nextIndex = state.currentIndex + 1;

      if (nextIndex >= state.playlist.length) {
        if (state.repeat === 'all') {
          nextIndex = 0; // 重頭開始
        } else {
          // 播放完畢，停止
          state.isPlaying = false;
          return;
        }
      }

      // 設置為 pending，等待載入完成後再切換
      state.pendingTrack = state.playlist[nextIndex];
      state.isLoadingTrack = true;
      state.isPlaying = true; // 標記要播放
    },
    playPrevious(state) {
      if (state.playlist.length === 0) return;

      // 如果已經播放超過 3 秒，則重播當前歌曲
      if (state.currentTime > 3) {
        state.currentTime = 0;
        state.seekTarget = 0;
        return;
      }

      let prevIndex = state.currentIndex - 1;

      if (prevIndex < 0) {
        if (state.repeat === 'all') {
          prevIndex = state.playlist.length - 1; // 跳到最後一首
        } else {
          prevIndex = 0; // 停在第一首
        }
      }

      // 設置為 pending，等待載入完成後再切換
      state.pendingTrack = state.playlist[prevIndex];
      state.isLoadingTrack = true;
      state.isPlaying = true; // 標記要播放
    },
  },
});

export const {
  setCurrentTrack,
  setPendingTrack,
  setIsLoadingTrack,
  confirmPendingTrack,
  cancelPendingTrack,
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
  setPlaylist,
  playNext,
  playPrevious,
} = playerSlice.actions;

export default playerSlice.reducer;
