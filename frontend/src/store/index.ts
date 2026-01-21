import { configureStore } from '@reduxjs/toolkit';
import playerReducer from './playerSlice';

export const store = configureStore({
  reducer: {
    player: playerReducer,
    // TODO: 加入其他 slices
    // lyrics: lyricsReducer,
    // playlist: playlistReducer,
    // theme: themeReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
