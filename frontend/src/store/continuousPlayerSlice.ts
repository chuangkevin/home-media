import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface ContinuousPlayerState {
  /** 是否啟用 continuous stream 模式 */
  isEnabled: boolean;
  /** 當前 session ID（null = 尚未建立） */
  sessionId: string | null;
  /** SSE 連線狀態 */
  isConnected: boolean;
}

const initialState: ContinuousPlayerState = {
  isEnabled: false,
  sessionId: null,
  isConnected: false,
};

const continuousPlayerSlice = createSlice({
  name: 'continuousPlayer',
  initialState,
  reducers: {
    setEnabled(state, action: PayloadAction<boolean>) {
      state.isEnabled = action.payload;
      if (!action.payload) {
        state.sessionId = null;
        state.isConnected = false;
      }
    },
    setSessionId(state, action: PayloadAction<string | null>) {
      state.sessionId = action.payload;
    },
    setConnected(state, action: PayloadAction<boolean>) {
      state.isConnected = action.payload;
    },
  },
});

export const { setEnabled, setSessionId, setConnected } = continuousPlayerSlice.actions;
export default continuousPlayerSlice.reducer;
