import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { socketService } from '../services/socket.service';
import {
  setDevices,
  setIsConnected,
  setIsReceiver,
  resetCasting,
} from '../store/castingSlice';
import {
  setIsPlaying,
  seekTo,
  setVolume,
  playNext,
  playPrevious,
  setPendingTrack,
} from '../store/playerSlice';

export function useSocketConnection() {
  const dispatch = useDispatch();

  useEffect(() => {
    // 設定回調
    socketService.setCallbacks({
      onConnected: (connected) => {
        dispatch(setIsConnected(connected));
        if (!connected) {
          dispatch(resetCasting());
        }
      },
      onDeviceList: (devices) => {
        dispatch(setDevices(devices));
      },
      onCastReceive: (data) => {
        dispatch(
          setIsReceiver({
            isReceiver: true,
            sourceId: data.sourceId,
            sourceName: data.sourceName,
          })
        );
        // 設定待播放曲目
        dispatch(setPendingTrack(data.track));
        dispatch(setIsPlaying(data.isPlaying));
        if (data.position > 0) {
          dispatch(seekTo(data.position));
        }
      },
      onControlExecute: (data) => {
        switch (data.command) {
          case 'play':
            dispatch(setIsPlaying(true));
            break;
          case 'pause':
            dispatch(setIsPlaying(false));
            break;
          case 'next':
            dispatch(playNext());
            break;
          case 'previous':
            dispatch(playPrevious());
            break;
          case 'seek':
            if (data.payload?.position !== undefined) {
              dispatch(seekTo(data.payload.position));
            }
            break;
          case 'volume':
            if (data.payload?.volume !== undefined) {
              dispatch(setVolume(data.payload.volume));
            }
            break;
        }
      },
      onCastEnded: () => {
        dispatch(setIsReceiver({ isReceiver: false }));
      },
    });

    // 連接 Socket
    socketService.connect();

    // 清理
    return () => {
      socketService.disconnect();
    };
  }, [dispatch]);
}
