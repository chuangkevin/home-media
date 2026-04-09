import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import apiService from '../services/api.service';

const initialState: { favoriteIds: Record<string, boolean>; loaded: boolean } = {
  favoriteIds: {},
  loaded: false,
};

export const fetchFavorites = createAsyncThunk('favorites/fetch', async () => {
  const items = await apiService.getFavorites();
  return items.map(f => f.video_id);
});

export const toggleFavorite = createAsyncThunk('favorites/toggle', async (payload: {
  videoId: string; title: string; channel?: string; thumbnail?: string; duration?: number;
}) => {
  const result = await apiService.toggleFavorite(payload);
  return { videoId: payload.videoId, favorited: result.favorited };
});

const favoritesSlice = createSlice({
  name: 'favorites',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchFavorites.fulfilled, (state, action) => {
        state.favoriteIds = {};
        action.payload.forEach(id => { state.favoriteIds[id] = true; });
        state.loaded = true;
      })
      .addCase(toggleFavorite.fulfilled, (state, action) => {
        if (action.payload.favorited) {
          state.favoriteIds[action.payload.videoId] = true;
        } else {
          delete state.favoriteIds[action.payload.videoId];
        }
      });
  },
});

export default favoritesSlice.reducer;
