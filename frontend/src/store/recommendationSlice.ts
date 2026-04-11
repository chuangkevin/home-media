import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import apiService, { RecommendationPage } from '../services/api.service';
import type { Track } from '../types/track.types';

export interface ChannelRecommendation {
  channelName: string;
  channelThumbnail: string;
  videos: Track[];
  watchCount: number;
  type?: 'channel' | 'similar' | 'discovery';
  hasMoreVideos?: boolean;
}

interface FetchRecommendationResult {
  recommendations: ChannelRecommendation[];
  hasMore: boolean;
  page: number;
}

interface RecommendationState {
  channelRecommendations: ChannelRecommendation[];
  currentPage: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  useMixedMode: boolean; // 新增：是否使用混合推薦模式
}

const initialState: RecommendationState = {
  channelRecommendations: [],
  currentPage: 0,
  hasMore: true,
  loading: false,
  error: null,
  lastUpdated: null,
  useMixedMode: true, // 預設使用混合推薦
};

export const fetchChannelRecommendations = createAsyncThunk(
  'recommendation/fetchChannelRecommendations',
  async ({ page, pageSize = 5, mixed = true }: { page: number; pageSize?: number; mixed?: boolean }) => {
    const response: RecommendationPage<ChannelRecommendation> = mixed
      ? await apiService.getMixedRecommendations(page, pageSize, 3)
      : await apiService.getChannelRecommendations(page, pageSize);

    return {
      recommendations: response.recommendations,
      hasMore: response.hasMore,
      page: response.page,
    } satisfies FetchRecommendationResult;
  }
);

export const loadMoreRecommendations = createAsyncThunk(
  'recommendation/loadMore',
  async (_, { getState }) => {
    const state = getState() as { recommendation: RecommendationState };
    const nextPage = state.recommendation.currentPage + 1;
    const mixed = state.recommendation.useMixedMode;
    
    const response: RecommendationPage<ChannelRecommendation> = mixed
      ? await apiService.getMixedRecommendations(nextPage, 5, 3)
      : await apiService.getChannelRecommendations(nextPage, 5);

    return {
      recommendations: response.recommendations,
      hasMore: response.hasMore,
      page: response.page,
    } satisfies FetchRecommendationResult;
  }
);

export const refreshRecommendations = createAsyncThunk(
  'recommendation/refresh',
  async (_, { getState }) => {
    const state = getState() as { recommendation: RecommendationState };
    const mixed = state.recommendation.useMixedMode;
    
    await apiService.refreshRecommendations();
    
    const response: RecommendationPage<ChannelRecommendation> = mixed
      ? await apiService.getMixedRecommendations(0, 5, 3)
      : await apiService.getChannelRecommendations(0, 5);

    return {
      recommendations: response.recommendations,
      hasMore: response.hasMore,
      page: response.page,
    } satisfies FetchRecommendationResult;
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
    toggleMixedMode: (state) => {
      state.useMixedMode = !state.useMixedMode;
      state.channelRecommendations = [];
      state.currentPage = 0;
      state.hasMore = true;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchChannelRecommendations.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchChannelRecommendations.fulfilled, (state, action: PayloadAction<FetchRecommendationResult>) => {
        state.loading = false;
        state.channelRecommendations = action.payload.recommendations;
        state.currentPage = action.payload.page;
        state.hasMore = action.payload.hasMore;
        state.lastUpdated = Date.now();
      })
      .addCase(fetchChannelRecommendations.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch recommendations';
      })
      .addCase(loadMoreRecommendations.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadMoreRecommendations.fulfilled, (state, action: PayloadAction<FetchRecommendationResult>) => {
        state.loading = false;
        state.channelRecommendations = [...state.channelRecommendations, ...action.payload.recommendations];
        state.currentPage = action.payload.page;
        state.hasMore = action.payload.hasMore;
      })
      .addCase(loadMoreRecommendations.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to load more';
      })
      .addCase(refreshRecommendations.fulfilled, (state, action: PayloadAction<FetchRecommendationResult>) => {
        state.channelRecommendations = action.payload.recommendations;
        state.currentPage = action.payload.page;
        state.hasMore = action.payload.hasMore;
        state.lastUpdated = Date.now();
      });
  },
});

export const { resetRecommendations, toggleMixedMode } = recommendationSlice.actions;
export default recommendationSlice.reducer;
