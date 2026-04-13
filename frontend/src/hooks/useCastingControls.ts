import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../store';
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
    },
    [dispatch]
  );

  const handleSeek = useCallback(
    (position: number) => {
      dispatch(seekTo(position));
    },
    [dispatch]
  );

  const handleVolume = useCallback(
    (volume: number) => {
      dispatch(setVolume(volume));
    },
    [dispatch]
  );

  const handleNext = useCallback(() => {
    dispatch(playNext());
  }, [dispatch]);

  const handlePrevious = useCallback(() => {
    dispatch(playPrevious());
  }, [dispatch]);

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
