import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import playbackStateService from '../services/playback-state.service';

export function usePlaybackPersistence(): void {
  const playlist = useSelector((state: RootState) => state.player.playlist);
  const currentIndex = useSelector((state: RootState) => state.player.currentIndex);
  const currentTime = useSelector((state: RootState) => state.player.currentTime);
  const volume = useSelector((state: RootState) => state.player.volume);
  const isPlaying = useSelector((state: RootState) => state.player.isPlaying);

  // Lifecycle: start/stop auto-save timer and visibilitychange listener
  useEffect(() => {
    playbackStateService.startAutoSave();
    return () => {
      playbackStateService.stopAutoSave();
    };
  }, []);

  // Save on every relevant state change; skip when playlist is empty
  useEffect(() => {
    if (playlist.length === 0) return;

    // Read currentTime from the real audio element for accuracy; fall back to Redux value
    const audioEl = document.querySelector('audio');
    const accurateCurrentTime = audioEl && audioEl.currentTime > 0 ? audioEl.currentTime : currentTime;

    playbackStateService.save({
      playlist: playlist.map((t) => ({
        id: t.id,
        videoId: t.videoId,
        title: t.title,
        channel: t.channel,
        thumbnail: t.thumbnail ?? '',
        duration: t.duration ?? 0,
      })),
      currentIndex,
      currentTime: accurateCurrentTime,
      volume,
      isPlaying,
    });
  }, [playlist, currentIndex, currentTime, volume, isPlaying]);
}
