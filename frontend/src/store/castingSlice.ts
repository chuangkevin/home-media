import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Device } from '../services/socket.service';

interface CastingState {
  devices: Device[];
  castTargets: string[];
  isController: boolean;
  isReceiver: boolean;
  sourceDeviceId: string | null;
  sourceDeviceName: string | null;
  isConnected: boolean;
}

const initialState: CastingState = {
  devices: [],
  castTargets: [],
  isController: false,
  isReceiver: false,
  sourceDeviceId: null,
  sourceDeviceName: null,
  isConnected: false,
};

const castingSlice = createSlice({
  name: 'casting',
  initialState,
  reducers: {
    setDevices(state, action: PayloadAction<Device[]>) {
      state.devices = action.payload;
    },
    setCastTargets(state, action: PayloadAction<string[]>) {
      state.castTargets = action.payload;
    },
    addCastTarget(state, action: PayloadAction<string>) {
      if (!state.castTargets.includes(action.payload)) {
        state.castTargets.push(action.payload);
      }
    },
    removeCastTarget(state, action: PayloadAction<string>) {
      state.castTargets = state.castTargets.filter((id) => id !== action.payload);
    },
    setIsController(state, action: PayloadAction<boolean>) {
      state.isController = action.payload;
      if (!action.payload) {
        state.castTargets = [];
      }
    },
    setIsReceiver(
      state,
      action: PayloadAction<{ isReceiver: boolean; sourceId?: string; sourceName?: string }>
    ) {
      state.isReceiver = action.payload.isReceiver;
      state.sourceDeviceId = action.payload.sourceId ?? null;
      state.sourceDeviceName = action.payload.sourceName ?? null;
    },
    setIsConnected(state, action: PayloadAction<boolean>) {
      state.isConnected = action.payload;
    },
    resetCasting(state) {
      state.castTargets = [];
      state.isController = false;
      state.isReceiver = false;
      state.sourceDeviceId = null;
      state.sourceDeviceName = null;
    },
  },
});

export const {
  setDevices,
  setCastTargets,
  addCastTarget,
  removeCastTarget,
  setIsController,
  setIsReceiver,
  setIsConnected,
  resetCasting,
} = castingSlice.actions;

export default castingSlice.reducer;
