import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { Track } from '../types/track.types';
import apiService, { Playlist, PlaylistWithTracks } from '../services/api.service';

interface PlaylistState {
  playlists: Playlist[];
  currentPlaylist: PlaylistWithTracks | null;
  isLoading: boolean;
  isCreating: boolean;
  error: string | null;
}

const initialState: PlaylistState = {
  playlists: [],
  currentPlaylist: null,
  isLoading: false,
  isCreating: false,
  error: null,
};

// 異步 Thunks
export const fetchPlaylists = createAsyncThunk(
  'playlists/fetchAll',
  async () => {
    return await apiService.getPlaylists();
  }
);

export const fetchPlaylist = createAsyncThunk(
  'playlists/fetchOne',
  async (playlistId: string) => {
    return await apiService.getPlaylist(playlistId);
  }
);

export const createPlaylist = createAsyncThunk(
  'playlists/create',
  async ({ name, description }: { name: string; description?: string }) => {
    return await apiService.createPlaylist(name, description);
  }
);

export const updatePlaylist = createAsyncThunk(
  'playlists/update',
  async ({ playlistId, name, description }: { playlistId: string; name?: string; description?: string }) => {
    await apiService.updatePlaylist(playlistId, name, description);
    return { playlistId, name, description };
  }
);

export const deletePlaylist = createAsyncThunk(
  'playlists/delete',
  async (playlistId: string) => {
    await apiService.deletePlaylist(playlistId);
    return playlistId;
  }
);

export const addTrackToPlaylist = createAsyncThunk(
  'playlists/addTrack',
  async ({ playlistId, track }: { playlistId: string; track: Track }) => {
    await apiService.addTrackToPlaylist(playlistId, track);
    return { playlistId, track };
  }
);

export const removeTrackFromPlaylist = createAsyncThunk(
  'playlists/removeTrack',
  async ({ playlistId, trackId }: { playlistId: string; trackId: string }) => {
    await apiService.removeTrackFromPlaylist(playlistId, trackId);
    return { playlistId, trackId };
  }
);

export const moveTrackInPlaylist = createAsyncThunk(
  'playlists/moveTrack',
  async ({ playlistId, trackId, position }: { playlistId: string; trackId: string; position: number }) => {
    await apiService.moveTrackInPlaylist(playlistId, trackId, position);
    return { playlistId, trackId, position };
  }
);

const playlistSlice = createSlice({
  name: 'playlists',
  initialState,
  reducers: {
    clearCurrentPlaylist(state) {
      state.currentPlaylist = null;
    },
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // fetchPlaylists
      .addCase(fetchPlaylists.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchPlaylists.fulfilled, (state, action) => {
        state.isLoading = false;
        state.playlists = action.payload;
      })
      .addCase(fetchPlaylists.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch playlists';
      })
      // fetchPlaylist
      .addCase(fetchPlaylist.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchPlaylist.fulfilled, (state, action) => {
        state.isLoading = false;
        state.currentPlaylist = action.payload;
      })
      .addCase(fetchPlaylist.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.error.message || 'Failed to fetch playlist';
      })
      // createPlaylist
      .addCase(createPlaylist.pending, (state) => {
        state.isCreating = true;
        state.error = null;
      })
      .addCase(createPlaylist.fulfilled, (state, action) => {
        state.isCreating = false;
        state.playlists.unshift(action.payload);
      })
      .addCase(createPlaylist.rejected, (state, action) => {
        state.isCreating = false;
        state.error = action.error.message || 'Failed to create playlist';
      })
      // updatePlaylist
      .addCase(updatePlaylist.fulfilled, (state, action) => {
        const { playlistId, name, description } = action.payload;
        const playlist = state.playlists.find(p => p.id === playlistId);
        if (playlist) {
          if (name) playlist.name = name;
          if (description !== undefined) playlist.description = description;
          playlist.updatedAt = Date.now();
        }
        if (state.currentPlaylist?.id === playlistId) {
          if (name) state.currentPlaylist.name = name;
          if (description !== undefined) state.currentPlaylist.description = description;
          state.currentPlaylist.updatedAt = Date.now();
        }
      })
      // deletePlaylist
      .addCase(deletePlaylist.fulfilled, (state, action) => {
        state.playlists = state.playlists.filter(p => p.id !== action.payload);
        if (state.currentPlaylist?.id === action.payload) {
          state.currentPlaylist = null;
        }
      })
      // addTrackToPlaylist
      .addCase(addTrackToPlaylist.fulfilled, (state, action) => {
        const { playlistId, track } = action.payload;
        // 更新播放清單曲目數
        const playlist = state.playlists.find(p => p.id === playlistId);
        if (playlist) {
          playlist.trackCount += 1;
          playlist.updatedAt = Date.now();
        }
        // 更新當前播放清單
        if (state.currentPlaylist?.id === playlistId) {
          state.currentPlaylist.tracks.push(track);
          state.currentPlaylist.trackCount += 1;
          state.currentPlaylist.updatedAt = Date.now();
        }
      })
      // removeTrackFromPlaylist
      .addCase(removeTrackFromPlaylist.fulfilled, (state, action) => {
        const { playlistId, trackId } = action.payload;
        // 更新播放清單曲目數
        const playlist = state.playlists.find(p => p.id === playlistId);
        if (playlist) {
          playlist.trackCount = Math.max(0, playlist.trackCount - 1);
          playlist.updatedAt = Date.now();
        }
        // 更新當前播放清單
        if (state.currentPlaylist?.id === playlistId) {
          state.currentPlaylist.tracks = state.currentPlaylist.tracks.filter(t => t.id !== trackId);
          state.currentPlaylist.trackCount = state.currentPlaylist.tracks.length;
          state.currentPlaylist.updatedAt = Date.now();
        }
      })
      // moveTrackInPlaylist
      .addCase(moveTrackInPlaylist.fulfilled, (state, action) => {
        const { playlistId, trackId, position } = action.payload;
        if (state.currentPlaylist?.id === playlistId) {
          const tracks = state.currentPlaylist.tracks;
          const currentIndex = tracks.findIndex(t => t.id === trackId);
          if (currentIndex !== -1 && currentIndex !== position) {
            const [track] = tracks.splice(currentIndex, 1);
            tracks.splice(position, 0, track);
          }
          state.currentPlaylist.updatedAt = Date.now();
        }
      });
  },
});

export const { clearCurrentPlaylist, clearError } = playlistSlice.actions;
export default playlistSlice.reducer;
