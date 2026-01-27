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
  const { playlist, currentIndex, isPlaying } = useSelector(
    (state: RootState) => state.player
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
    // 投射時發送下一首曲目到目標裝置
    if (isController && castTargets.length > 0) {
      const nextIndex = currentIndex + 1;
      if (nextIndex < playlist.length) {
        const nextTrack = playlist[nextIndex];
        socketService.startCast(castTargets, nextTrack, 0, isPlaying);
      }
    }
  }, [dispatch, isController, castTargets, playlist, currentIndex, isPlaying]);

  const handlePrevious = useCallback(() => {
    dispatch(playPrevious());
    // 投射時發送上一首曲目到目標裝置
    if (isController && castTargets.length > 0) {
      const prevIndex = currentIndex - 1;
      if (prevIndex >= 0) {
        const prevTrack = playlist[prevIndex];
        socketService.startCast(castTargets, prevTrack, 0, isPlaying);
      }
    }
  }, [dispatch, isController, castTargets, playlist, currentIndex, isPlaying]);

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
