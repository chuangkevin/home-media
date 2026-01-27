import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../store';
import { socketService } from '../services/socket.service';
import {
  setIsPlaying,
  seekTo,
  setVolume,
  playNext,
  playPrevious,
} from '../store/playerSlice';

export function useCastingControls() {
  const dispatch = useDispatch();
  const { isController, castTargets } = useSelector(
    (state: RootState) => state.casting
  );

  const handlePlayPause = useCallback(
    (playing: boolean) => {
      dispatch(setIsPlaying(playing));
      if (isController && castTargets.length > 0) {
        socketService.sendCommand(castTargets, playing ? 'play' : 'pause');
      }
    },
    [dispatch, isController, castTargets]
  );

  const handleSeek = useCallback(
    (position: number) => {
      dispatch(seekTo(position));
      if (isController && castTargets.length > 0) {
        socketService.sendCommand(castTargets, 'seek', { position });
      }
    },
    [dispatch, isController, castTargets]
  );

  const handleVolume = useCallback(
    (volume: number) => {
      dispatch(setVolume(volume));
      if (isController && castTargets.length > 0) {
        socketService.sendCommand(castTargets, 'volume', { volume });
      }
    },
    [dispatch, isController, castTargets]
  );

  const handleNext = useCallback(() => {
    dispatch(playNext());
    if (isController && castTargets.length > 0) {
      socketService.sendCommand(castTargets, 'next');
    }
  }, [dispatch, isController, castTargets]);

  const handlePrevious = useCallback(() => {
    dispatch(playPrevious());
    if (isController && castTargets.length > 0) {
      socketService.sendCommand(castTargets, 'previous');
    }
  }, [dispatch, isController, castTargets]);

  return {
    handlePlayPause,
    handleSeek,
    handleVolume,
    handleNext,
    handlePrevious,
    isController,
    castTargets,
  };
}
