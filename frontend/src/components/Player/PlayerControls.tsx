import { useState } from 'react';
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

interface PlayerControlsProps {
  embedded?: boolean;
  isCompact?: boolean;
}

export default function PlayerControls({ embedded = false, isCompact = false }: PlayerControlsProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

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

  const onSeekChange = (_event: Event, value: number | number[]) => {
    setIsSeeking(true);
    setSeekValue(value as number);
  };

  const onSeekCommit = (_event: React.SyntheticEvent | Event, value: number | number[]) => {
    handleSeek(value as number);
    setIsSeeking(false);
  };

  const onVolumeChange = (_event: Event, value: number | number[]) => {
    handleVolume(value as number);
  };

  const toggleMute = () => {
    handleVolume(volume > 0 ? 0 : 0.7);
  };

  // 檢查是否有上一首/下一首
  const hasPrevious = playlist.length > 0 && currentIndex > 0;
  // 允許在最後一首時也能點下一首（會停止或循環，取決於 repeat 設定）
  const hasNext = playlist.length > 0;

  if (isCompact && !embedded) {
    // ===== 迷你模式：進度條 + 按鈕在同一行 =====
    return (
      <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="caption" sx={{ minWidth: 32, textAlign: 'right', fontSize: '0.7rem' }}>
          {formatDuration(Math.floor(currentTime))}
        </Typography>
        <Slider size="small" value={isSeeking ? seekValue : currentTime} max={duration || 100} onChange={onSeekChange} onChangeCommitted={onSeekCommit} sx={{ flex: 1, mx: 0.5 }} />
        <IconButton size="small" onClick={handlePrevious} disabled={!hasPrevious} sx={{ p: 0.5 }}>
          <SkipPreviousIcon fontSize="small" />
        </IconButton>
        <IconButton onClick={onPlayPause} color="primary" size="small" sx={{ p: 0.5 }}>
          {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <IconButton size="small" onClick={handleNext} disabled={!hasNext} sx={{ p: 0.5 }}>
          <SkipNextIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={toggleMute} sx={{ p: 0.5 }}>
          <VolumeIcon fontSize="small" />
        </IconButton>
        <CastButton />
      </Box>
    );
  }

  // ===== 標準模式（embedded 全螢幕歌詞用）=====
  return (
    <Box sx={{ width: '100%', mt: 1 }}>
      {/* 進度條 */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="caption" sx={{ minWidth: 40, textAlign: 'right' }}>
          {formatDuration(Math.floor(currentTime))}
        </Typography>
        <Slider
          size="small"
          value={isSeeking ? seekValue : currentTime}
          max={duration || 100}
          onChange={onSeekChange}
          onChangeCommitted={onSeekCommit}
          sx={{ flexGrow: 1 }}
        />
        <Typography variant="caption" sx={{ minWidth: 40 }}>
          {formatDuration(Math.floor(duration))}
        </Typography>
      </Stack>

      {/* 控制按鈕 */}
      <Stack direction="row" spacing={1} alignItems="center">
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

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
          <IconButton size="small" onClick={toggleMute}>
            <VolumeIcon />
          </IconButton>
          {(!isMobile || embedded) && (
            <Slider size="small" value={volume} min={0} max={1} step={0.01} onChange={onVolumeChange} sx={{ width: embedded ? 100 : 80 }} />
          )}
          <CastButton />
        </Box>
      </Stack>
    </Box>
  );
}
