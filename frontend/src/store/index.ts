import { configureStore } from '@reduxjs/toolkit';
import playerReducer from './playerSlice';
import historyReducer from './historySlice';
import recommendationReducer from './recommendationSlice';
import lyricsReducer from './lyricsSlice';

export const store = configureStore({
  reducer: {
    player: playerReducer,
    history: historyReducer,
    recommendation: recommendationReducer,
    lyrics: lyricsReducer,
    // TODO: 加入其他 slices
    // playlist: playlistReducer,
    // theme: themeReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
