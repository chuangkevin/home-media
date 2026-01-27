import { useSelector } from 'react-redux';
import { Box, IconButton, Slider, Typography, Stack, useMediaQuery, useTheme } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeDownIcon from '@mui/icons-material/VolumeDown';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { RootState } from '../../store';
import { formatDuration } from '../../utils/formatTime';
import { CastButton } from '../Cast';
import { useCastingControls } from '../../hooks/useCastingControls';

export default function PlayerControls() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const { isPlaying, currentTime, duration, volume, playlist, currentIndex } = useSelector(
    (state: RootState) => state.player
  );

  // 使用 casting controls - 會同時控制本地和遠端裝置
  const {
    handlePlayPause,
    handleSeek,
    handleVolume,
    handleNext,
    handlePrevious,
  } = useCastingControls();

  // 根據音量顯示不同圖示
  const VolumeIcon = volume === 0 ? VolumeOffIcon : volume < 0.5 ? VolumeDownIcon : VolumeUpIcon;

  const onPlayPause = () => {
    handlePlayPause(!isPlaying);
  };

  const onSeek = (_event: Event, value: number | number[]) => {
    handleSeek(value as number);
  };

  const onVolumeChange = (_event: Event, value: number | number[]) => {
    handleVolume(value as number);
  };

  const toggleMute = () => {
    handleVolume(volume > 0 ? 0 : 0.7);
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
          onChange={onSeek}
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
          <IconButton onClick={onPlayPause} color="primary" size="large">
            {isPlaying ? <PauseIcon fontSize="large" /> : <PlayArrowIcon fontSize="large" />}
          </IconButton>
          <IconButton size="small" onClick={handleNext} disabled={!hasNext}>
            <SkipNextIcon />
          </IconButton>
        </Box>

        {/* 音量控制 + 投射按鈕 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
          <IconButton size="small" onClick={toggleMute}>
            <VolumeIcon />
          </IconButton>
          {/* 桌面版顯示音量滑桿 */}
          {!isMobile && (
            <Slider
              size="small"
              value={volume}
              min={0}
              max={1}
              step={0.01}
              onChange={onVolumeChange}
              sx={{ width: 80 }}
            />
          )}
          {/* 投射按鈕 */}
          <CastButton />
        </Box>
      </Stack>
    </Box>
  );
}
