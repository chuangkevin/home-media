import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import apiService from '../services/api.service';
import { Track } from './playerSlice';

export interface ChannelRecommendation {
  channelName: string;
  channelThumbnail: string;
  videos: Track[];
  watchCount: number;
}

interface RecommendationState {
  channelRecommendations: ChannelRecommendation[];
  currentPage: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

const initialState: RecommendationState = {
  channelRecommendations: [],
  currentPage: 0,
  hasMore: true,
  loading: false,
  error: null,
  lastUpdated: null,
};

export const fetchChannelRecommendations = createAsyncThunk(
  'recommendation/fetchChannelRecommendations',
  async ({ page, pageSize = 5 }: { page: number; pageSize?: number }) => {
    return await apiService.getChannelRecommendations(page, pageSize);
  }
);

export const loadMoreRecommendations = createAsyncThunk(
  'recommendation/loadMore',
  async (_, { getState }) => {
    const state = getState() as { recommendation: RecommendationState };
    const nextPage = state.recommendation.currentPage + 1;
    return await apiService.getChannelRecommendations(nextPage, 5);
  }
);

export const refreshRecommendations = createAsyncThunk(
  'recommendation/refresh',
  async () => {
    await apiService.refreshRecommendations();
    return await apiService.getChannelRecommendations(0, 5);
  }
);

const recommendationSlice = createSlice({
  name: 'recommendation',
  initialState,
  reducers: {
    resetRecommendations: (state) => {
      state.channelRecommendations = [];
      state.currentPage = 0;
      state.hasMore = true;
      state.lastUpdated = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchChannelRecommendations.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchChannelRecommendations.fulfilled, (state, action: PayloadAction<ChannelRecommendation[]>) => {
        state.loading = false;
        state.channelRecommendations = action.payload;
        state.currentPage = 0;
        state.hasMore = action.payload.length > 0;
        state.lastUpdated = Date.now();
      })
      .addCase(fetchChannelRecommendations.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch recommendations';
      })
      .addCase(loadMoreRecommendations.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadMoreRecommendations.fulfilled, (state, action: PayloadAction<ChannelRecommendation[]>) => {
        state.loading = false;
        state.channelRecommendations = [...state.channelRecommendations, ...action.payload];
        state.currentPage += 1;
        state.hasMore = action.payload.length > 0;
      })
      .addCase(loadMoreRecommendations.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to load more';
      })
      .addCase(refreshRecommendations.fulfilled, (state, action: PayloadAction<ChannelRecommendation[]>) => {
        state.channelRecommendations = action.payload;
        state.currentPage = 0;
        state.hasMore = action.payload.length > 0;
        state.lastUpdated = Date.now();
      });
  },
});

export const { resetRecommendations } = recommendationSlice.actions;
export default recommendationSlice.reducer;
