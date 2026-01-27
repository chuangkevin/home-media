import { configureStore } from '@reduxjs/toolkit';
import playerReducer from './playerSlice';
import historyReducer from './historySlice';
import recommendationReducer from './recommendationSlice';
import lyricsReducer from './lyricsSlice';
import castingReducer from './castingSlice';

export const store = configureStore({
  reducer: {
    player: playerReducer,
    history: historyReducer,
    recommendation: recommendationReducer,
    lyrics: lyricsReducer,
    casting: castingReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
