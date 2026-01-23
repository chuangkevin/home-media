import { useEffect, useRef } from 'react';
import { Box, Typography, Paper, CircularProgress, Alert, IconButton, Tooltip, Chip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store';
import type { Track } from '../../types/track.types';
import { setCurrentLineIndex, adjustTimeOffset, resetTimeOffset } from '../../store/lyricsSlice';

interface LyricsViewProps {
  track: Track;
}

export default function LyricsView({ track }: LyricsViewProps) {
  const dispatch = useDispatch();
  const { currentLyrics, isLoading, error, currentLineIndex, timeOffset } = useSelector(
    (state: RootState) => state.lyrics
  );
  const { currentTime } = useSelector((state: RootState) => state.player);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 根據當前時間計算應該高亮的歌詞行（加入時間偏移）
  useEffect(() => {
    if (!currentLyrics || !currentLyrics.isSynced || currentLyrics.lines.length === 0) {
      return;
    }

    const lines = currentLyrics.lines;
    let newLineIndex = -1;

    // 計算調整後的時間（加上偏移量）
    // timeOffset > 0 表示歌詞提前（音樂慢），需要用更大的時間來匹配
    // timeOffset < 0 表示歌詞延後（音樂快），需要用更小的時間來匹配
    const adjustedTime = currentTime + timeOffset;

    // 找到當前時間對應的歌詞行
    for (let i = 0; i < lines.length; i++) {
      if (adjustedTime >= lines[i].time) {
        newLineIndex = i;
      } else {
        break;
      }
    }

    if (newLineIndex !== currentLineIndex) {
      dispatch(setCurrentLineIndex(newLineIndex));
    }
  }, [currentTime, timeOffset, currentLyrics, currentLineIndex, dispatch]);

  // 自動滾動到當前歌詞行
  useEffect(() => {
    if (currentLineIndex >= 0 && lineRefs.current[currentLineIndex]) {
      lineRefs.current[currentLineIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentLineIndex]);

  // 時間偏移控制
  const handleOffsetIncrease = () => {
    dispatch(adjustTimeOffset(0.5)); // 歌詞提前 0.5 秒
  };

  const handleOffsetDecrease = () => {
    dispatch(adjustTimeOffset(-0.5)); // 歌詞延後 0.5 秒
  };

  const handleOffsetReset = () => {
    dispatch(resetTimeOffset());
  };

  // 渲染歌詞
  const renderLyrics = () => {
    if (isLoading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      );
    }

    if (error) {
      return (
        <Alert severity="warning" sx={{ mx: 2 }}>
          {error}
        </Alert>
      );
    }

    if (!currentLyrics) {
      return (
        <Typography variant="body1" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
          無法找到歌詞
        </Typography>
      );
    }

    if (currentLyrics.lines.length === 0) {
      return (
        <Typography variant="body1" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
          此曲目沒有歌詞
        </Typography>
      );
    }

    return (
      <Box sx={{ px: 2, py: 3 }}>
        {currentLyrics.lines.map((line, index) => {
          const isActive = currentLyrics.isSynced && index === currentLineIndex;
          const isPassed = currentLyrics.isSynced && index < currentLineIndex;

          return (
            <Box
              key={index}
              ref={(el: HTMLDivElement | null) => (lineRefs.current[index] = el)}
              sx={{
                py: 1.5,
                px: 2,
                textAlign: 'center',
                transition: 'all 0.3s ease',
                borderRadius: 1,
                backgroundColor: isActive ? 'action.selected' : 'transparent',
              }}
            >
              <Typography
                variant="h6"
                sx={{
                  fontWeight: isActive ? 700 : 400,
                  fontSize: isActive ? '1.5rem' : '1.1rem',
                  color: isActive
                    ? 'primary.main'
                    : isPassed
                    ? 'text.secondary'
                    : 'text.primary',
                  opacity: isPassed ? 0.5 : 1,
                  transition: 'all 0.3s ease',
                }}
              >
                {line.text}
              </Typography>
            </Box>
          );
        })}
      </Box>
    );
  };

  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: 800,
        mx: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
      }}
    >
      {/* 封面圖 */}
      <Box
        component="img"
        src={track.thumbnail}
        alt={track.title}
        sx={{
          width: '100%',
          maxWidth: 400,
          aspectRatio: '16/9',
          borderRadius: 2,
          boxShadow: 6,
          objectFit: 'cover',
        }}
      />

      {/* 曲目資訊 */}
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
          {track.title}
        </Typography>
        <Typography variant="subtitle1" color="text.secondary">
          {track.channel}
        </Typography>
        {currentLyrics && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            歌詞來源: {currentLyrics.source === 'youtube' ? 'YouTube CC' : currentLyrics.source}
            {currentLyrics.isSynced ? ' (同步)' : ' (純文字)'}
          </Typography>
        )}
      </Box>

      {/* 歌詞時間微調控制 - 只在同步歌詞時顯示 */}
      {currentLyrics?.isSynced && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            時間微調:
          </Typography>
          <Tooltip title="歌詞延後 0.5 秒">
            <IconButton size="small" onClick={handleOffsetDecrease}>
              <RemoveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Chip
            label={timeOffset === 0 ? '0s' : `${timeOffset > 0 ? '+' : ''}${timeOffset.toFixed(1)}s`}
            size="small"
            color={timeOffset === 0 ? 'default' : 'primary'}
            sx={{ minWidth: 60 }}
          />
          <Tooltip title="歌詞提前 0.5 秒">
            <IconButton size="small" onClick={handleOffsetIncrease}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {timeOffset !== 0 && (
            <Tooltip title="重置">
              <IconButton size="small" onClick={handleOffsetReset}>
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )}

      {/* 歌詞區域 */}
      <Paper
        ref={lyricsContainerRef}
        elevation={0}
        sx={{
          width: '100%',
          maxHeight: '500px',
          overflow: 'auto',
          backgroundColor: 'background.default',
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: 'background.paper',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'action.selected',
            borderRadius: '4px',
          },
        }}
      >
        {renderLyrics()}
      </Paper>
    </Box>
  );
}
