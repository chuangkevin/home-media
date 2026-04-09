import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import apiService from '../services/api.service';

export interface BlockedItem {
  id: number;
  type: 'song' | 'channel';
  video_id: string | null;
  channel_name: string | null;
  title: string;
  thumbnail: string | null;
  blocked_at: number;
}

interface BlockState {
  items: BlockedItem[];
  loaded: boolean;
}

const initialState: BlockState = {
  items: [],
  loaded: false,
};

export const fetchBlocked = createAsyncThunk('block/fetch', async () => {
  return await apiService.getBlockedItems();
});

export const blockItem = createAsyncThunk('block/add', async (payload: {
  type: 'song' | 'channel';
  videoId?: string;
  channelName?: string;
  title: string;
  thumbnail?: string;
}) => {
  const res = await apiService.addBlockedItem(payload);
  // Re-fetch full list to get the item with id
  const items = await apiService.getBlockedItems();
  return { items, newId: res.id };
});

export const unblockItem = createAsyncThunk('block/remove', async (id: number) => {
  await apiService.removeBlockedItem(id);
  return id;
});

const blockSlice = createSlice({
  name: 'block',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchBlocked.fulfilled, (state, action) => {
        state.items = action.payload;
        state.loaded = true;
      })
      .addCase(blockItem.fulfilled, (state, action) => {
        state.items = action.payload.items;
      })
      .addCase(unblockItem.fulfilled, (state, action) => {
        state.items = state.items.filter(i => i.id !== action.payload);
      });
  },
});

export default blockSlice.reducer;
