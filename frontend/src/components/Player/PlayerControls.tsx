import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Box, IconButton, Slider, Typography, Stack, useMediaQuery, useTheme, alpha } from '@mui/material';
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
  const isUltrawide = useMediaQuery('(min-width: 1200px) and (max-height: 800px)'); // 針對 1920*720 平板
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
      <Box sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: isUltrawide ? 2 : 0.5 }}>
        <Typography
          variant="caption"
          sx={{
            minWidth: 32,
            textAlign: 'right',
            fontSize: isUltrawide ? '0.85rem' : '0.67rem',
            fontFamily: '"Outfit", sans-serif',
            fontVariantNumeric: 'tabular-nums',
            color: 'text.secondary',
          }}
        >
          {formatDuration(Math.floor(currentTime))}
        </Typography>
        <Slider
          size={isUltrawide ? "medium" : "small"}
          value={isSeeking ? seekValue : currentTime}
          max={duration || 100}
          onChange={onSeekChange}
          onChangeCommitted={onSeekCommit}
          sx={{ flex: 1, mx: 0.5 }}
        />
        <IconButton size={isUltrawide ? "large" : "small"} onClick={handlePrevious} disabled={!hasPrevious} sx={{ p: 0.5 }}>
          <SkipPreviousIcon fontSize={isUltrawide ? "medium" : "small"} />
        </IconButton>
        <IconButton
          onClick={onPlayPause}
          color="primary"
          size={isUltrawide ? "large" : "small"}
          sx={{
            p: isUltrawide ? 1.5 : 0.5,
            backgroundColor: (t) => alpha(t.palette.primary.main, 0.13),
            '&:hover': { backgroundColor: (t) => alpha(t.palette.primary.main, 0.24) },
            transition: 'all 0.18s ease',
          }}
        >
          {isPlaying ? <PauseIcon fontSize={isUltrawide ? "large" : "medium"} /> : <PlayArrowIcon fontSize={isUltrawide ? "large" : "medium"} />}
        </IconButton>
        <IconButton size={isUltrawide ? "large" : "small"} onClick={handleNext} disabled={!hasNext} sx={{ p: 0.5 }}>
          <SkipNextIcon fontSize={isUltrawide ? "medium" : "small"} />
        </IconButton>
        <IconButton size={isUltrawide ? "large" : "small"} onClick={toggleMute} sx={{ p: 0.5 }}>
          <VolumeIcon fontSize={isUltrawide ? "medium" : "small"} />
        </IconButton>
        <CastButton />
      </Box>
    );
  }

  // ===== 標準模式（embedded 全螢幕歌詞用）=====
  return (
    <Box sx={{ width: '100%', mt: isUltrawide ? 0 : 1 }}>
      {/* 進度條 */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: isUltrawide ? 0.5 : 1 }}>
        <Typography
          variant="caption"
          sx={{
            minWidth: 40,
            textAlign: 'right',
            fontFamily: '"Outfit", sans-serif',
            fontVariantNumeric: 'tabular-nums',
            color: 'text.secondary',
            fontSize: isUltrawide ? '0.85rem' : '0.72rem',
          }}
        >
          {formatDuration(Math.floor(currentTime))}
        </Typography>
        <Slider
          size={isUltrawide ? "medium" : "small"}
          value={isSeeking ? seekValue : currentTime}
          max={duration || 100}
          onChange={onSeekChange}
          onChangeCommitted={onSeekCommit}
          sx={{ flexGrow: 1 }}
        />
        <Typography
          variant="caption"
          sx={{
            minWidth: 40,
            fontFamily: '"Outfit", sans-serif',
            fontVariantNumeric: 'tabular-nums',
            color: 'text.secondary',
            fontSize: isUltrawide ? '0.85rem' : '0.72rem',
          }}
        >
          {formatDuration(Math.floor(duration))}
        </Typography>
      </Stack>

      {/* 控制按鈕 */}
      <Stack direction="row" spacing={isUltrawide ? 3 : 1} alignItems="center">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: isUltrawide ? 2 : 0.5 }}>
          <IconButton size={isUltrawide ? "large" : "small"} onClick={handlePrevious} disabled={!hasPrevious}>
            <SkipPreviousIcon fontSize={isUltrawide ? "large" : "medium"} />
          </IconButton>
          <IconButton
            onClick={onPlayPause}
            color="primary"
            size="large"
            sx={{
              p: isUltrawide ? 2 : 1,
              backgroundColor: (t) => alpha(t.palette.primary.main, 0.13),
              '&:hover': { backgroundColor: (t) => alpha(t.palette.primary.main, 0.24) },
              transition: 'all 0.18s ease',
            }}
          >
            {isPlaying ? <PauseIcon sx={{ fontSize: isUltrawide ? 48 : 32 }} /> : <PlayArrowIcon sx={{ fontSize: isUltrawide ? 48 : 32 }} />}
          </IconButton>
          <IconButton size={isUltrawide ? "large" : "small"} onClick={handleNext} disabled={!hasNext}>
            <SkipNextIcon fontSize={isUltrawide ? "large" : "medium"} />
          </IconButton>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: isUltrawide ? 2 : 1, ml: 'auto' }}>
          <IconButton size={isUltrawide ? "large" : "small"} onClick={toggleMute}>
            <VolumeIcon fontSize={isUltrawide ? "medium" : "medium"} />
          </IconButton>
          {(!isMobile || embedded) && (
            <Slider size={isUltrawide ? "medium" : "small"} value={volume} min={0} max={1} step={0.01} onChange={onVolumeChange} sx={{ width: isUltrawide ? 150 : (embedded ? 100 : 80) }} />
          )}
          <CastButton />
        </Box>
      </Stack>
    </Box>
  );
}
