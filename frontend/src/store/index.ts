import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { activateLyricsTrack } from './lyricsSlice';
import playerReducer from './playerSlice';
import historyReducer from './historySlice';
import recommendationReducer from './recommendationSlice';
import lyricsReducer from './lyricsSlice';
import castingReducer from './castingSlice';
import playlistReducer from './playlistSlice';
import radioReducer from './radioSlice';
import continuousPlayerReducer from './continuousPlayerSlice';
import blockReducer from './blockSlice';
import favoritesReducer from './favoritesSlice';

const combinedReducer = combineReducers({
    player: playerReducer,
    history: historyReducer,
    recommendation: recommendationReducer,
    lyrics: lyricsReducer,
    casting: castingReducer,
    playlists: playlistReducer,
    radio: radioReducer,
    continuousPlayer: continuousPlayerReducer,
    block: blockReducer,
    favorites: favoritesReducer,
});

// Atomic ownership change: pending audio leaves the currently playing lyrics
// intact. Every confirmed playback path (including radio/crossfade) clears them.
export const store = configureStore({
  reducer: (state: ReturnType<typeof combinedReducer> | undefined, action: Parameters<typeof combinedReducer>[1]) => {
    const next = combinedReducer(state, action);
    const videoId = next.player.currentTrack?.videoId ?? null;
    if (next.lyrics.videoId === videoId) return next;
    return { ...next, lyrics: lyricsReducer(next.lyrics, activateLyricsTrack(videoId)) };
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
