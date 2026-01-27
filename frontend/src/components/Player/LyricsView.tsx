import { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Paper, CircularProgress, Alert, IconButton, Tooltip, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, List,
  ListItem, ListItemText, ListItemButton, InputAdornment
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store';
import type { Track } from '../../types/track.types';
import type { LRCLIBSearchResult } from '../../types/lyrics.types';
import { setCurrentLineIndex, adjustTimeOffset, resetTimeOffset, setTimeOffset, setCurrentLyrics } from '../../store/lyricsSlice';
import { seekTo } from '../../store/playerSlice';
import apiService from '../../services/api.service';
import lyricsCacheService from '../../services/lyrics-cache.service';

interface LyricsViewProps {
  track: Track;
  onVisibilityChange?: (isVisible: boolean) => void; // 歌詞區域可見性變化回調
}

export default function LyricsView({ track, onVisibilityChange }: LyricsViewProps) {
  const dispatch = useDispatch();
  const { currentLyrics, isLoading, error, currentLineIndex, timeOffset } = useSelector(
    (state: RootState) => state.lyrics
  );
  const { currentTime } = useSelector((state: RootState) => state.player);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lyricsViewRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 搜尋對話框狀態
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LRCLIBSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isLyricsVisible, setIsLyricsVisible] = useState(true); // 歌詞容器是否可見

  // 固定填充高度（容器 maxHeight 500px 的一半）
  const PADDING_HEIGHT = 250;

  // 載入儲存的偏好設定
  useEffect(() => {
    const loadPreference = async () => {
      const pref = await lyricsCacheService.getPreference(track.videoId);
      if (pref?.timeOffset !== undefined && pref.timeOffset !== 0) {
        console.log(`📝 套用儲存的時間偏移: ${pref.timeOffset}s`);
        dispatch(setTimeOffset(pref.timeOffset));
      }
    };
    loadPreference();
  }, [track.videoId, dispatch]);

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

  // 自動滾動到當前歌詞行（只在歌詞可見時才滾動）
  useEffect(() => {
    // 如果歌詞不可見，不滾動
    if (!isLyricsVisible) return;

    const container = lyricsContainerRef.current;
    const line = lineRefs.current[currentLineIndex];

    if (currentLineIndex >= 0 && container && line) {
      // 使用 getBoundingClientRect 計算精確位置
      const containerRect = container.getBoundingClientRect();
      const lineRect = line.getBoundingClientRect();

      // 計算歌詞行中心與容器中心的差距
      const lineCenter = lineRect.top + lineRect.height / 2;
      const containerCenter = containerRect.top + containerRect.height / 2;
      const scrollOffset = lineCenter - containerCenter;

      // 調整 scrollTop 讓歌詞行居中
      container.scrollTo({
        top: container.scrollTop + scrollOffset,
        behavior: 'smooth',
      });
    }
  }, [currentLineIndex, isLyricsVisible]);

  // 監聯歌詞容器是否可見（控制自動滾動 + 顯示「看歌詞」按鈕）
  useEffect(() => {
    const container = lyricsContainerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting;
        setIsLyricsVisible(visible);
        // 通知父元件（用於顯示「看歌詞」按鈕）
        onVisibilityChange?.(visible);
      },
      { threshold: 0.3 } // 30% 可見才算可見
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, [onVisibilityChange, currentLyrics]);

  // 點選歌詞跳轉到對應時間
  const handleLyricClick = (time: number, index: number) => {
    if (!currentLyrics?.isSynced) return;
    // 扣除時間偏移量，因為播放時會加回去
    const targetTime = Math.max(0, time - timeOffset);
    dispatch(seekTo(targetTime));

    // 直接滾動到點選的歌詞行（置中顯示）
    const container = lyricsContainerRef.current;
    const line = lineRefs.current[index];
    if (container && line) {
      const containerRect = container.getBoundingClientRect();
      const lineRect = line.getBoundingClientRect();
      const lineCenter = lineRect.top + lineRect.height / 2;
      const containerCenter = containerRect.top + containerRect.height / 2;
      const scrollOffset = lineCenter - containerCenter;

      container.scrollTo({
        top: container.scrollTop + scrollOffset,
        behavior: 'smooth',
      });
    }
  };

  // 時間偏移控制（並儲存到 IndexedDB），最小單位 0.1 秒
  const handleOffsetIncrease = () => {
    const newOffset = Math.round((timeOffset + 0.1) * 10) / 10;
    dispatch(adjustTimeOffset(0.1));
    lyricsCacheService.setTimeOffset(track.videoId, Math.min(10, newOffset));
  };

  const handleOffsetDecrease = () => {
    const newOffset = Math.round((timeOffset - 0.1) * 10) / 10;
    dispatch(adjustTimeOffset(-0.1));
    lyricsCacheService.setTimeOffset(track.videoId, Math.max(-10, newOffset));
  };

  const handleOffsetReset = () => {
    dispatch(resetTimeOffset());
    lyricsCacheService.setTimeOffset(track.videoId, 0);
  };

  // 搜尋歌詞
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const results = await apiService.searchLyrics(searchQuery);
      setSearchResults(results);
    } catch (error) {
      console.error('Search lyrics failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // 選擇歌詞
  const handleSelectLyrics = async (result: LRCLIBSearchResult) => {
    setIsApplying(true);
    try {
      const lyrics = await apiService.getLyricsByLRCLIBId(track.videoId, result.id);
      if (lyrics) {
        // 儲存選擇
        await lyricsCacheService.setLrclibId(track.videoId, result.id);
        // 更新快取
        await lyricsCacheService.set(track.videoId, lyrics);
        // 更新 Redux
        dispatch(setCurrentLyrics(lyrics));
        // 關閉對話框
        setSearchOpen(false);
        console.log(`✅ 已套用歌詞: ${result.trackName} - ${result.artistName}`);
      }
    } catch (error) {
      console.error('Apply lyrics failed:', error);
    } finally {
      setIsApplying(false);
    }
  };

  // 打開搜尋對話框時，預設填入歌曲名稱
  const handleOpenSearch = () => {
    // 嘗試從標題中提取歌名
    const match = track.title.match(/[【《]([^【】《》]+)[】》]/);
    const defaultQuery = match ? match[1] : track.title.split(/[-–—]/)[0].trim();
    setSearchQuery(defaultQuery);
    setSearchResults([]);
    setSearchOpen(true);
  };

  // 格式化時長
  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
      <Box sx={{ px: 2 }}>
        {/* 頂部填充：讓第一行歌詞可以顯示在正中間 */}
        <Box sx={{ height: `${PADDING_HEIGHT}px` }} />
        {currentLyrics.lines.map((line, index) => {
          const isActive = currentLyrics.isSynced && index === currentLineIndex;
          const isPassed = currentLyrics.isSynced && index < currentLineIndex;

          return (
            <Box
              key={index}
              ref={(el: HTMLDivElement | null) => (lineRefs.current[index] = el)}
              onClick={() => currentLyrics.isSynced && handleLyricClick(line.time, index)}
              sx={{
                py: 1.5,
                px: 2,
                textAlign: 'center',
                transition: 'all 0.3s ease',
                borderRadius: 1,
                backgroundColor: isActive ? 'action.selected' : 'transparent',
                cursor: currentLyrics.isSynced ? 'pointer' : 'default',
                '&:hover': currentLyrics.isSynced ? {
                  backgroundColor: 'action.hover',
                } : {},
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
        {/* 底部填充：讓最後一行歌詞可以顯示在正中間 */}
        <Box sx={{ height: `${PADDING_HEIGHT}px` }} />
      </Box>
    );
  };

  return (
    <Box
      ref={lyricsViewRef}
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
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 0.5 }}>
          {currentLyrics && (
            <Chip
              label={`${
                currentLyrics.source === 'youtube' ? 'YouTube CC' :
                currentLyrics.source === 'netease' ? '網易雲音樂' :
                currentLyrics.source === 'lrclib' ? 'LRCLIB' :
                currentLyrics.source === 'genius' ? 'Genius' :
                currentLyrics.source
              } ${currentLyrics.isSynced ? '(同步)' : '(純文字)'}`}
              size="small"
              color={currentLyrics.isSynced ? 'primary' : 'default'}
              variant="outlined"
            />
          )}
          <Tooltip title="搜尋其他歌詞">
            <IconButton size="small" onClick={handleOpenSearch}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* 歌詞時間微調控制 - 只在同步歌詞時顯示 */}
      {currentLyrics?.isSynced && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            時間微調:
          </Typography>
          <Tooltip title="歌詞延後 0.1 秒">
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
          <Tooltip title="歌詞提前 0.1 秒">
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
        id="lyrics-scroll-target"
        ref={lyricsContainerRef}
        elevation={0}
        sx={{
          width: '100%',
          height: '500px',
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

      {/* 歌詞搜尋對話框 */}
      <Dialog open={searchOpen} onClose={() => setSearchOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>搜尋歌詞</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="輸入歌名或關鍵字"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            sx={{ mt: 1 }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton onClick={handleSearch} disabled={isSearching}>
                    {isSearching ? <CircularProgress size={20} /> : <SearchIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          {searchResults.length > 0 && (
            <List sx={{ mt: 2, maxHeight: 300, overflow: 'auto' }}>
              {searchResults.map((result) => (
                <ListItem key={result.id} disablePadding>
                  <ListItemButton
                    onClick={() => handleSelectLyrics(result)}
                    disabled={isApplying}
                  >
                    <ListItemText
                      primary={result.trackName}
                      secondary={
                        <Box component="span" sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                          <span>{result.artistName}</span>
                          {result.albumName && <span>· {result.albumName}</span>}
                          {result.duration && <span>· {formatDuration(result.duration)}</span>}
                          {result.hasSyncedLyrics && (
                            <Chip label="同步" size="small" color="primary" sx={{ height: 20 }} />
                          )}
                        </Box>
                      }
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
          {searchResults.length === 0 && !isSearching && searchQuery && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
              點擊搜尋按鈕或按 Enter 搜尋
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSearchOpen(false)}>取消</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
