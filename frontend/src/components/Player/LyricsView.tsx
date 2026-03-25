import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, CircularProgress, Alert, IconButton, Tooltip, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, List,
  ListItem, ListItemText, ListItemButton, InputAdornment, ToggleButtonGroup, ToggleButton
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SearchIcon from '@mui/icons-material/Search';
import EditIcon from '@mui/icons-material/Edit';
import TuneIcon from '@mui/icons-material/Tune';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store';
import type { Track } from '../../types/track.types';
import type { LyricsSearchResult, LyricsSource } from '../../types/lyrics.types';
import { setCurrentLineIndex, adjustTimeOffset, resetTimeOffset, setTimeOffset, setCurrentLyrics } from '../../store/lyricsSlice';
import { seekTo } from '../../store/playerSlice';
import apiService from '../../services/api.service';
import lyricsCacheService from '../../services/lyrics-cache.service';
import { toTraditional } from '../../utils/chineseConvert';

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
  const [searchResults, setSearchResults] = useState<LyricsSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isLyricsVisible, setIsLyricsVisible] = useState(true); // 歌詞容器是否可見
  const [searchSource, setSearchSource] = useState<LyricsSource>('lrclib'); // 歌詞來源

  // 微調模式狀態
  const [isFineTuning, setIsFineTuning] = useState(false);
  const [fineTuneOffset, setFineTuneOffset] = useState(0); // 微調時的臨時偏移量
  const [isReloadingLyrics, setIsReloadingLyrics] = useState(false);

  // 固定填充高度（容器 maxHeight 500px 的一半）
  const PADDING_HEIGHT = 250;

  // 載入儲存的偏好設定（優先使用後端 API，IndexedDB 作為離線備份）
  useEffect(() => {
    const loadPreference = async () => {
      try {
        // 1. 嘗試從後端 API 載入（跨裝置同步）
        const backendPrefs = await apiService.getLyricsPreferences(track.videoId);
        if (backendPrefs?.timeOffset !== undefined && backendPrefs.timeOffset !== 0) {
          console.log(`📝 套用後端儲存的時間偏移: ${backendPrefs.timeOffset}s`);
          dispatch(setTimeOffset(backendPrefs.timeOffset));
          // 同步到本地快取（離線支援）
          lyricsCacheService.setTimeOffset(track.videoId, backendPrefs.timeOffset);
          return;
        }
      } catch (error) {
        console.warn('後端偏好載入失敗，使用本地快取', error);
      }

      // 2. 後端沒有資料時，嘗試從本地 IndexedDB 載入（離線模式）
      const localPref = await lyricsCacheService.getPreference(track.videoId);
      if (localPref?.timeOffset !== undefined && localPref.timeOffset !== 0) {
        console.log(`📝 套用本地儲存的時間偏移: ${localPref.timeOffset}s`);
        dispatch(setTimeOffset(localPref.timeOffset));
        // 同步到後端（如果之前是離線調整的）
        apiService.updateLyricsPreferences(track.videoId, { timeOffset: localPref.timeOffset });
      }
    };
    loadPreference();
  }, [track.videoId, dispatch]);

  // 使用 rAF 直接讀取 audio.currentTime，避免 Redux dispatch 延遲
  const rafIdRef = useRef<number>(0);
  const lastLineIndexRef = useRef<number>(-1);

  const scrollToLine = useCallback((lineIndex: number) => {
    if (!isLyricsVisible || isFineTuning) return;

    const container = lyricsContainerRef.current;
    const line = lineRefs.current[lineIndex];

    if (lineIndex >= 0 && container && line) {
      const containerRect = container.getBoundingClientRect();
      const lineRect = line.getBoundingClientRect();
      const lineCenter = lineRect.top + lineRect.height / 2;
      const containerCenter = containerRect.top + containerRect.height / 2;
      const scrollOffset = lineCenter - containerCenter;

      // 只在偏移量超過 2px 時才滾動，避免不必要的微小滾動
      if (Math.abs(scrollOffset) > 2) {
        container.scrollTo({
          top: container.scrollTop + scrollOffset,
          behavior: 'smooth',
        });
      }
    }
  }, [isLyricsVisible, isFineTuning]);

  // rAF-based line detection: reads audio.currentTime directly each frame
  useEffect(() => {
    if (!currentLyrics || !currentLyrics.isSynced || currentLyrics.lines.length === 0) {
      return;
    }

    // 是否應該運行 rAF 循環
    const shouldRun = isLyricsVisible && !document.hidden;
    if (!shouldRun) return;

    const lines = currentLyrics.lines;
    let running = true;

    const tick = () => {
      if (!running) return;

      const audio = document.querySelector('audio');
      if (audio) {
        // 直接從 audio 元素讀取 currentTime，避免 Redux 延遲
        const adjustedTime = audio.currentTime + timeOffset;

        // 找到當前時間對應的歌詞行
        let newLineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
          if (adjustedTime >= lines[i].time) {
            newLineIndex = i;
          } else {
            break;
          }
        }

        // 只在行索引變化時更新 Redux 和滾動
        if (newLineIndex !== lastLineIndexRef.current) {
          lastLineIndexRef.current = newLineIndex;
          dispatch(setCurrentLineIndex(newLineIndex));
          scrollToLine(newLineIndex);
        }
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);

    // visibilitychange 監聽：tab 切換時暫停/恢復
    const handleVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafIdRef.current);
      } else {
        rafIdRef.current = requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      running = false;
      cancelAnimationFrame(rafIdRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentLyrics, timeOffset, isLyricsVisible, isFineTuning, dispatch, scrollToLine]);

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

  // 時間偏移控制（同步儲存到後端 SQLite + 本地 IndexedDB），最小單位 0.1 秒（不限制範圍）
  const handleOffsetIncrease = () => {
    const newOffset = Math.round((timeOffset + 0.1) * 10) / 10;
    dispatch(adjustTimeOffset(0.1));
    // 儲存到後端（跨裝置同步）和本地（離線支援）
    apiService.updateLyricsPreferences(track.videoId, { timeOffset: newOffset });
    lyricsCacheService.setTimeOffset(track.videoId, newOffset);
  };

  const handleOffsetDecrease = () => {
    const newOffset = Math.round((timeOffset - 0.1) * 10) / 10;
    dispatch(adjustTimeOffset(-0.1));
    // 儲存到後端（跨裝置同步）和本地（離線支援）
    apiService.updateLyricsPreferences(track.videoId, { timeOffset: newOffset });
    lyricsCacheService.setTimeOffset(track.videoId, newOffset);
  };

  const handleOffsetReset = () => {
    dispatch(resetTimeOffset());
    // 儲存到後端（跨裝置同步）和本地（離線支援）
    apiService.updateLyricsPreferences(track.videoId, { timeOffset: 0 });
    lyricsCacheService.setTimeOffset(track.videoId, 0);
  };

  // ==================== 微調模式 ====================

  // 進入微調模式
  const handleEnterFineTune = () => {
    setFineTuneOffset(timeOffset);
    setIsFineTuning(true);
  };

  // 取消微調
  const handleCancelFineTune = () => {
    setIsFineTuning(false);
    setFineTuneOffset(0);
  };

  // 確認微調（儲存偏移量到後端 + 本地）
  const handleConfirmFineTune = () => {
    const newOffset = Math.round(fineTuneOffset * 10) / 10;
    dispatch(setTimeOffset(newOffset));
    // 儲存到後端（跨裝置同步）和本地（離線支援）
    apiService.updateLyricsPreferences(track.videoId, { timeOffset: newOffset });
    lyricsCacheService.setTimeOffset(track.videoId, newOffset);
    setIsFineTuning(false);
    console.log(`✅ 已套用時間偏移: ${newOffset}s (已同步)`);
  };

  // 微調模式下滾動調整偏移
  const handleFineTuneScroll = () => {
    if (!isFineTuning || !currentLyrics?.isSynced || !lyricsContainerRef.current) return;

    const container = lyricsContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    const containerCenter = containerRect.top + containerRect.height / 2;

    // 找到最接近中心的歌詞行
    let closestIndex = -1;
    let closestDistance = Infinity;

    lineRefs.current.forEach((lineEl, index) => {
      if (!lineEl || !currentLyrics.lines[index]) return;
      const lineRect = lineEl.getBoundingClientRect();
      const lineCenter = lineRect.top + lineRect.height / 2;
      const distance = Math.abs(lineCenter - containerCenter);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    if (closestIndex >= 0 && currentLyrics.lines[closestIndex]) {
      // 計算偏移量：如果歌詞行時間是 10s，當前播放時間是 8s，偏移應該是 +2s
      // timeOffset = lineTime - currentTime
      const lineTime = currentLyrics.lines[closestIndex].time;
      const newOffset = lineTime - currentTime;
      setFineTuneOffset(Math.round(newOffset * 10) / 10);
    }
  };

  // 重新載入原始歌詞（清除快取，讓後端重新自動搜尋）
  const handleReloadOriginalLyrics = async () => {
    setIsReloadingLyrics(true);
    try {
      // 清除本地快取
      await lyricsCacheService.delete(track.videoId);
      // 清除本地偏好設定（包括 lrclibId）
      await lyricsCacheService.clearPreference(track.videoId);
      // 重置後端偏好（跨裝置同步）
      apiService.updateLyricsPreferences(track.videoId, { timeOffset: 0, lrclibId: null });

      // 重新從後端獲取歌詞（後端會自動搜尋 YouTube CC, NetEase, LRCLIB, Genius）
      const lyrics = await apiService.getLyrics(track.videoId, track.title, track.channel);

      if (lyrics) {
        // 更新本地快取
        await lyricsCacheService.set(track.videoId, lyrics);
        // 更新 Redux
        dispatch(setCurrentLyrics(lyrics));
        // 重置時間偏移
        dispatch(resetTimeOffset());
        console.log(`✅ 已重新載入原始歌詞 (${lyrics.source})`);
      } else {
        dispatch(setCurrentLyrics(null));
        console.log('⚠️ 無法找到歌詞');
      }

      setSearchOpen(false);
    } catch (error) {
      console.error('Reload lyrics failed:', error);
    } finally {
      setIsReloadingLyrics(false);
    }
  };

  // 搜尋歌詞
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchResults([]); // 清空舊結果
    try {
      const results = await apiService.searchLyrics(searchQuery, searchSource);
      setSearchResults(results);
    } catch (error) {
      console.error('Search lyrics failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // 選擇歌詞
  const handleSelectLyrics = async (result: LyricsSearchResult) => {
    setIsApplying(true);
    try {
      // 根據來源使用不同的 API
      const lyrics = searchSource === 'netease'
        ? await apiService.getLyricsByNeteaseId(track.videoId, result.id)
        : await apiService.getLyricsByLRCLIBId(track.videoId, result.id);

      if (lyrics) {
        // 儲存選擇（同步到後端和本地）
        if (searchSource === 'lrclib') {
          // LRCLIB
          apiService.updateLyricsPreferences(track.videoId, { lrclibId: result.id });
          await lyricsCacheService.setLrclibId(track.videoId, result.id);
        } else if (searchSource === 'netease') {
          // NetEase
          apiService.updateLyricsPreferences(track.videoId, { neteaseId: result.id });
          await lyricsCacheService.setNeteaseId(track.videoId, result.id);
        }
        // 更新本地快取
        await lyricsCacheService.set(track.videoId, lyrics);
        // 更新 Redux
        dispatch(setCurrentLyrics(lyrics));
        // 關閉對話框
        setSearchOpen(false);
        console.log(`✅ 已套用歌詞 (${searchSource}): ${result.trackName} - ${result.artistName} (已同步)`);
      }
    } catch (error) {
      console.error('Apply lyrics failed:', error);
    } finally {
      setIsApplying(false);
    }
  };

  // 切換來源時清空結果
  const handleSourceChange = (_: React.MouseEvent<HTMLElement>, newSource: LyricsSource | null) => {
    if (newSource) {
      setSearchSource(newSource);
      setSearchResults([]); // 切換時清空結果
    }
  };

  // 打開搜尋對話框時，預設填入歌曲名稱
  const handleOpenSearch = () => {
    // 嘗試從標題中提取歌名（考慮頻道名稱匹配）
    const match = track.title.match(/[【《]([^【】《》]+)[】》]/);
    let defaultQuery: string;
    if (match) {
      defaultQuery = match[1];
    } else {
      // 清理後綴後，根據頻道名判斷 artist-title 分割方向
      const cleaned = track.title
        .replace(/\s*[\(\[【《].*?(official|mv|music video|lyric|lyrics|audio|hd|hq|4k|1080p).*?[\)\]】》]/gi, '')
        .replace(/\s*-\s*(official|mv|music video|lyric|lyrics|audio).*$/gi, '')
        .replace(/\s*(official|mv|music video|lyrics?|lyric video)$/gi, '')
        .trim();
      const dashSplit = cleaned.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      if (dashSplit && track.channel) {
        const cleanChannel = track.channel.replace(/\s*-\s*topic$/i, '').replace(/\s*vevo$/i, '').replace(/\s*official$/i, '').trim().toLowerCase();
        const before = dashSplit[1].trim().toLowerCase();
        const after = dashSplit[2].trim().toLowerCase();
        if (before === cleanChannel || cleanChannel.includes(before) || before.includes(cleanChannel)) {
          defaultQuery = dashSplit[2].trim(); // artist before dash → song is after
        } else if (after === cleanChannel || cleanChannel.includes(after) || after.includes(cleanChannel)) {
          defaultQuery = dashSplit[1].trim(); // artist after dash → song is before
        } else {
          defaultQuery = cleaned; // no match, use full cleaned title
        }
      } else {
        defaultQuery = cleaned;
      }
    }
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
                {toTraditional(line.text)}
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
          {isFineTuning ? (
            // 微調模式 UI
            <>
              <Typography variant="body2" color="primary" sx={{ fontWeight: 600 }}>
                滑動歌詞對準音樂:
              </Typography>
              <Chip
                label={fineTuneOffset === 0 ? '0s' : `${fineTuneOffset > 0 ? '+' : ''}${fineTuneOffset.toFixed(1)}s`}
                size="small"
                color="primary"
                sx={{ minWidth: 70 }}
              />
              <Tooltip title="確認套用">
                <IconButton size="small" onClick={handleConfirmFineTune} color="success">
                  <CheckIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="取消">
                <IconButton size="small" onClick={handleCancelFineTune} color="error">
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          ) : (
            // 一般模式 UI
            <>
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
              <Tooltip title="滑動微調模式">
                <IconButton size="small" onClick={handleEnterFineTune} color="primary">
                  <TuneIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Box>
      )}

      {/* 歌詞區域 */}
      <Paper
        id="lyrics-scroll-target"
        ref={lyricsContainerRef}
        elevation={0}
        onScroll={isFineTuning ? handleFineTuneScroll : undefined}
        sx={{
          width: '100%',
          height: '500px',
          overflow: 'auto',
          backgroundColor: 'background.default',
          position: 'relative',
          // 微調模式下顯示中心指示線
          ...(isFineTuning && {
            '&::before': {
              content: '""',
              position: 'sticky',
              top: '50%',
              left: 0,
              right: 0,
              display: 'block',
              height: '2px',
              backgroundColor: 'primary.main',
              opacity: 0.8,
              zIndex: 10,
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            },
          }),
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: 'background.paper',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: isFineTuning ? 'primary.main' : 'action.selected',
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
          {/* 平台選擇器 */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2, mt: 1 }}>
            <ToggleButtonGroup
              value={searchSource}
              exclusive
              onChange={handleSourceChange}
              size="small"
            >
              <ToggleButton value="lrclib">
                LRCLIB
              </ToggleButton>
              <ToggleButton value="netease">
                網易雲音樂
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <TextField
            autoFocus
            fullWidth
            label="輸入歌名或關鍵字"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
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
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          <Button
            onClick={handleReloadOriginalLyrics}
            disabled={isReloadingLyrics}
            startIcon={isReloadingLyrics ? <CircularProgress size={16} /> : <RefreshIcon />}
            color="secondary"
          >
            重新自動搜尋
          </Button>
          <Button onClick={() => setSearchOpen(false)}>取消</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
