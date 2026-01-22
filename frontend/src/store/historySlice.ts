import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import apiService from '../services/api.service';

export interface SearchHistoryItem {
  id: string;
  query: string;
  searchCount: number;
  lastSearchedAt: number;
  firstSearchedAt: number;
  resultCount: number;
}

export interface WatchedChannel {
  id: string;
  channelId: string;
  channelName: string;
  channelThumbnail: string;
  watchCount: number;
  lastWatchedAt: number;
  firstWatchedAt: number;
}

interface HistoryState {
  searchHistory: SearchHistoryItem[];
  watchedChannels: WatchedChannel[];
  loading: boolean;
  error: string | null;
}

const initialState: HistoryState = {
  searchHistory: [],
  watchedChannels: [],
  loading: false,
  error: null,
};

export const fetchSearchHistory = createAsyncThunk(
  'history/fetchSearchHistory',
  async ({ limit = 50, sortBy = 'recent' }: { limit?: number; sortBy?: 'recent' | 'popular' } = {}) => {
    return await apiService.getSearchHistory(limit, sortBy);
  }
);

export const fetchWatchedChannels = createAsyncThunk(
  'history/fetchWatchedChannels',
  async ({ limit = 50, sortBy = 'recent' }: { limit?: number; sortBy?: 'recent' | 'popular' } = {}) => {
    return await apiService.getWatchedChannels(limit, sortBy);
  }
);

export const clearSearchHistory = createAsyncThunk(
  'history/clearSearchHistory',
  async () => {
    await apiService.clearSearchHistory();
  }
);

export const clearChannelHistory = createAsyncThunk(
  'history/clearChannelHistory',
  async () => {
    await apiService.clearChannelHistory();
  }
);

const historySlice = createSlice({
  name: 'history',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSearchHistory.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchSearchHistory.fulfilled, (state, action: PayloadAction<SearchHistoryItem[]>) => {
        state.loading = false;
        state.searchHistory = action.payload;
      })
      .addCase(fetchSearchHistory.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch search history';
      })
      .addCase(fetchWatchedChannels.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchWatchedChannels.fulfilled, (state, action: PayloadAction<WatchedChannel[]>) => {
        state.loading = false;
        state.watchedChannels = action.payload;
      })
      .addCase(fetchWatchedChannels.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch watched channels';
      })
      .addCase(clearSearchHistory.fulfilled, (state) => {
        state.searchHistory = [];
      })
      .addCase(clearChannelHistory.fulfilled, (state) => {
        state.watchedChannels = [];
      });
  },
});

export default historySlice.reducer;
