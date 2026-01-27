import { useDispatch, useSelector } from 'react-redux';
import { Box, IconButton, Slider, Typography, Stack } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { RootState } from '../../store';
import { setIsPlaying, seekTo, setVolume, playNext, playPrevious } from '../../store/playerSlice';
import { formatDuration } from '../../utils/formatTime';
import { CastButton } from '../Cast';

export default function PlayerControls() {
  const dispatch = useDispatch();
  const { isPlaying, currentTime, duration, volume, playlist, currentIndex } = useSelector(
    (state: RootState) => state.player
  );

  const handlePlayPause = () => {
    dispatch(setIsPlaying(!isPlaying));
  };

  const handleSeek = (_event: Event, value: number | number[]) => {
    const newTime = value as number;
    dispatch(seekTo(newTime));
  };

  const handleVolumeChange = (_event: Event, value: number | number[]) => {
    dispatch(setVolume(value as number));
  };

  const toggleMute = () => {
    dispatch(setVolume(volume > 0 ? 0 : 0.7));
  };

  const handlePrevious = () => {
    dispatch(playPrevious());
  };

  const handleNext = () => {
    dispatch(playNext());
  };

  // 檢查是否有上一首/下一首
  const hasPrevious = playlist.length > 0 && currentIndex > 0;
  const hasNext = playlist.length > 0 && currentIndex < playlist.length - 1;

  return (
    <Box sx={{ width: '100%', mt: 1 }}>
      {/* 進度條 */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="caption" sx={{ minWidth: 40, textAlign: 'right' }}>
          {formatDuration(Math.floor(currentTime))}
        </Typography>
        <Slider
          size="small"
          value={currentTime}
          max={duration || 100}
          onChange={handleSeek}
          sx={{ flexGrow: 1 }}
        />
        <Typography variant="caption" sx={{ minWidth: 40 }}>
          {formatDuration(Math.floor(duration))}
        </Typography>
      </Stack>

      {/* 控制按鈕 */}
      <Stack direction="row" spacing={1} alignItems="center">
        {/* 播放控制 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <IconButton size="small" onClick={handlePrevious} disabled={!hasPrevious}>
            <SkipPreviousIcon />
          </IconButton>
          <IconButton onClick={handlePlayPause} color="primary" size="large">
            {isPlaying ? <PauseIcon fontSize="large" /> : <PlayArrowIcon fontSize="large" />}
          </IconButton>
          <IconButton size="small" onClick={handleNext} disabled={!hasNext}>
            <SkipNextIcon />
          </IconButton>
        </Box>

        {/* 音量控制 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto', minWidth: 150 }}>
          <IconButton size="small" onClick={toggleMute}>
            {volume === 0 ? <VolumeOffIcon /> : <VolumeUpIcon />}
          </IconButton>
          <Slider
            size="small"
            value={volume}
            min={0}
            max={1}
            step={0.01}
            onChange={handleVolumeChange}
            sx={{ width: 100 }}
          />
        </Box>

        {/* 投射按鈕 */}
        <CastButton />
      </Stack>
    </Box>
  );
}
