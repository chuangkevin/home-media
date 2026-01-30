import { useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Drawer, CircularProgress, Alert, IconButton, Tooltip, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, List,
  ListItem, ListItemText, ListItemButton, InputAdornment, ToggleButtonGroup, ToggleButton,
  ListItemAvatar, Avatar
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
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import LyricsIcon from '@mui/icons-material/Lyrics';
import OndemandVideoIcon from '@mui/icons-material/OndemandVideo';
import AlbumIcon from '@mui/icons-material/Album';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ClosedCaptionIcon from '@mui/icons-material/ClosedCaption';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store';
import type { Track } from '../../types/track.types';
import type { LyricsSearchResult, LyricsSource } from '../../types/lyrics.types';
import { setCurrentLineIndex, adjustTimeOffset, resetTimeOffset, setTimeOffset, setCurrentLyrics } from '../../store/lyricsSlice';
import { seekTo, setPendingTrack, setIsPlaying, setCurrentTime } from '../../store/playerSlice';
import apiService from '../../services/api.service';
import lyricsCacheService from '../../services/lyrics-cache.service';
import { toTraditional } from '../../utils/chineseConvert';

type ViewMode = 'lyrics' | 'video' | 'cover';

// 擴展 Window 介面以支援 YouTube API
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

interface FullscreenLyricsProps {
  open: boolean;
  onClose: () => void;
  track: Track;
}

export default function FullscreenLyrics({ open, onClose, track }: FullscreenLyricsProps) {
  const dispatch = useDispatch();
  const { currentLyrics, isLoading, error, currentLineIndex, timeOffset } = useSelector(
    (state: RootState) => state.lyrics
  );
  const { currentTime, playlist, currentIndex } = useSelector((state: RootState) => state.player);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  // 顯示模式
  const [viewMode, setViewMode] = useState<ViewMode>('lyrics');

  // 搜尋對話框狀態
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LyricsSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [searchSource, setSearchSource] = useState<LyricsSource>('lrclib');

  // 微調模式狀態
  const [isFineTuning, setIsFineTuning] = useState(false);
  const [fineTuneOffset, setFineTuneOffset] = useState(0);
  const [isReloadingLyrics, setIsReloadingLyrics] = useState(false);

  // YouTube CC 載入狀態
  const [isLoadingYouTubeCC, setIsLoadingYouTubeCC] = useState(false);

  // YouTube 播放器狀態
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const videoTimeSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 獲取播放狀態
  const { isPlaying: audioIsPlaying } = useSelector((state: RootState) => state.player);

  // 載入 YouTube IFrame API
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // 初始化或銷毀 YouTube 播放器
  useEffect(() => {
    if (!open || viewMode !== 'video' || !videoContainerRef.current) {
      // 銷毀播放器
      if (playerRef.current && playerRef.current.destroy) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      setVideoReady(false);
      // 清除時間同步
      if (videoTimeSyncRef.current) {
        clearInterval(videoTimeSyncRef.current);
        videoTimeSyncRef.current = null;
      }
      return;
    }

    let isMounted = true;
    setVideoError(null);
    setVideoReady(false);

    const initPlayer = () => {
      if (!isMounted || !videoContainerRef.current) return;

      if (window.YT && window.YT.Player) {
        playerRef.current = new window.YT.Player(videoContainerRef.current, {
          videoId: track.videoId,
          playerVars: {
            autoplay: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            start: Math.floor(currentTime),
            playsinline: 1, // 手機端內嵌播放
          },
          events: {
            onReady: (event: any) => {
              if (!isMounted) return;
              setVideoReady(true);
              // 同步到當前播放時間
              event.target.seekTo(currentTime, true);
              // 如果音訊正在播放，影片也播放
              if (audioIsPlaying) {
                event.target.playVideo();
              }
            },
            onStateChange: (event: any) => {
              if (!isMounted) return;
              // YT.PlayerState: PLAYING=1, PAUSED=2, BUFFERING=3
              if (event.data === 1) {
                // 影片開始播放，同步播放狀態
                dispatch(setIsPlaying(true));
              } else if (event.data === 2) {
                // 影片暫停
                dispatch(setIsPlaying(false));
              }
            },
            onError: (event: any) => {
              // YouTube 嵌入錯誤
              const errorCode = event.data;
              if (errorCode === 101 || errorCode === 150) {
                setVideoError('此影片不允許嵌入播放，請切換到其他模式');
              } else {
                setVideoError('影片載入失敗');
              }
            },
          },
        });
      }
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      isMounted = false;
      if (playerRef.current && playerRef.current.destroy) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      setVideoReady(false);
    };
  }, [open, viewMode, track.videoId]);

  // 同步影片播放時間到 Redux
  useEffect(() => {
    if (!videoReady || viewMode !== 'video' || !playerRef.current) {
      if (videoTimeSyncRef.current) {
        clearInterval(videoTimeSyncRef.current);
        videoTimeSyncRef.current = null;
      }
      return;
    }

    videoTimeSyncRef.current = setInterval(() => {
      if (playerRef.current && playerRef.current.getCurrentTime) {
        const videoTime = playerRef.current.getCurrentTime();
        if (typeof videoTime === 'number' && !isNaN(videoTime)) {
          dispatch(setCurrentTime(videoTime));
        }
      }
    }, 500);

    return () => {
      if (videoTimeSyncRef.current) {
        clearInterval(videoTimeSyncRef.current);
        videoTimeSyncRef.current = null;
      }
    };
  }, [videoReady, viewMode, dispatch]);

  // 同步播放/暫停狀態到影片
  useEffect(() => {
    if (!videoReady || viewMode !== 'video' || !playerRef.current) return;

    try {
      if (audioIsPlaying) {
        playerRef.current.playVideo?.();
      } else {
        playerRef.current.pauseVideo?.();
      }
    } catch (e) {
      // 忽略播放器尚未準備好的錯誤
    }
  }, [audioIsPlaying, videoReady, viewMode]);

  // 載入儲存的偏好設定
  useEffect(() => {
    if (!open) return;

    const loadPreference = async () => {
      try {
        const backendPrefs = await apiService.getLyricsPreferences(track.videoId);
        if (backendPrefs?.timeOffset !== undefined && backendPrefs.timeOffset !== 0) {
          dispatch(setTimeOffset(backendPrefs.timeOffset));
          lyricsCacheService.setTimeOffset(track.videoId, backendPrefs.timeOffset);
          return;
        }
      } catch (error) {
        console.warn('後端偏好載入失敗', error);
      }

      const localPref = await lyricsCacheService.getPreference(track.videoId);
      if (localPref?.timeOffset !== undefined && localPref.timeOffset !== 0) {
        dispatch(setTimeOffset(localPref.timeOffset));
        apiService.updateLyricsPreferences(track.videoId, { timeOffset: localPref.timeOffset });
      }
    };
    loadPreference();
  }, [track.videoId, dispatch, open]);

  // 根據當前時間計算高亮歌詞行
  useEffect(() => {
    if (!currentLyrics || !currentLyrics.isSynced || currentLyrics.lines.length === 0) {
      return;
    }

    const lines = currentLyrics.lines;
    let newLineIndex = -1;
    const adjustedTime = currentTime + timeOffset;

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
    if (!open || isFineTuning || viewMode !== 'lyrics') return;

    const container = lyricsContainerRef.current;
    const line = lineRefs.current[currentLineIndex];

    if (currentLineIndex >= 0 && container && line) {
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
  }, [currentLineIndex, open, isFineTuning, viewMode]);

  // 點選歌詞跳轉
  const handleLyricClick = (time: number, index: number) => {
    if (!currentLyrics?.isSynced) return;
    const targetTime = Math.max(0, time - timeOffset);
    dispatch(seekTo(targetTime));

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

  // 時間偏移控制
  const handleOffsetIncrease = () => {
    const newOffset = Math.round((timeOffset + 0.1) * 10) / 10;
    dispatch(adjustTimeOffset(0.1));
    apiService.updateLyricsPreferences(track.videoId, { timeOffset: newOffset });
    lyricsCacheService.setTimeOffset(track.videoId, newOffset);
  };

  const handleOffsetDecrease = () => {
    const newOffset = Math.round((timeOffset - 0.1) * 10) / 10;
    dispatch(adjustTimeOffset(-0.1));
    apiService.updateLyricsPreferences(track.videoId, { timeOffset: newOffset });
    lyricsCacheService.setTimeOffset(track.videoId, newOffset);
  };

  const handleOffsetReset = () => {
    dispatch(resetTimeOffset());
    apiService.updateLyricsPreferences(track.videoId, { timeOffset: 0 });
    lyricsCacheService.setTimeOffset(track.videoId, 0);
  };

  // 微調模式
  const handleEnterFineTune = () => {
    setFineTuneOffset(timeOffset);
    setIsFineTuning(true);
  };

  const handleCancelFineTune = () => {
    setIsFineTuning(false);
    setFineTuneOffset(0);
  };

  const handleConfirmFineTune = () => {
    const newOffset = Math.round(fineTuneOffset * 10) / 10;
    dispatch(setTimeOffset(newOffset));
    apiService.updateLyricsPreferences(track.videoId, { timeOffset: newOffset });
    lyricsCacheService.setTimeOffset(track.videoId, newOffset);
    setIsFineTuning(false);
  };

  const handleFineTuneScroll = () => {
    if (!isFineTuning || !currentLyrics?.isSynced || !lyricsContainerRef.current) return;

    const container = lyricsContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    const containerCenter = containerRect.top + containerRect.height / 2;

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
      const lineTime = currentLyrics.lines[closestIndex].time;
      const newOffset = lineTime - currentTime;
      setFineTuneOffset(Math.round(newOffset * 10) / 10);
    }
  };

  // 重新載入歌詞
  const handleReloadOriginalLyrics = async () => {
    setIsReloadingLyrics(true);
    try {
      await lyricsCacheService.delete(track.videoId);
      await lyricsCacheService.clearPreference(track.videoId);
      apiService.updateLyricsPreferences(track.videoId, { timeOffset: 0, lrclibId: null });

      const lyrics = await apiService.getLyrics(track.videoId, track.title, track.channel);

      if (lyrics) {
        await lyricsCacheService.set(track.videoId, lyrics);
        dispatch(setCurrentLyrics(lyrics));
        dispatch(resetTimeOffset());
      } else {
        dispatch(setCurrentLyrics(null));
      }

      setSearchOpen(false);
    } catch (error) {
      console.error('Reload lyrics failed:', error);
    } finally {
      setIsReloadingLyrics(false);
    }
  };

  // 使用 YouTube CC 字幕
  const handleUseYouTubeCC = async () => {
    setIsLoadingYouTubeCC(true);
    try {
      const lyrics = await apiService.getYouTubeCaptions(track.videoId);

      if (lyrics) {
        await lyricsCacheService.set(track.videoId, lyrics);
        dispatch(setCurrentLyrics(lyrics));
        dispatch(resetTimeOffset());
        setSearchOpen(false);
      } else {
        alert('此影片沒有可用的 YouTube CC 字幕');
      }
    } catch (error) {
      console.error('Fetch YouTube CC failed:', error);
      alert('獲取 YouTube CC 字幕失敗');
    } finally {
      setIsLoadingYouTubeCC(false);
    }
  };

  // 搜尋歌詞
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchResults([]);
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
      const lyrics = searchSource === 'netease'
        ? await apiService.getLyricsByNeteaseId(track.videoId, result.id)
        : await apiService.getLyricsByLRCLIBId(track.videoId, result.id);

      if (lyrics) {
        if (searchSource === 'lrclib') {
          apiService.updateLyricsPreferences(track.videoId, { lrclibId: result.id });
          await lyricsCacheService.setLrclibId(track.videoId, result.id);
        }
        await lyricsCacheService.set(track.videoId, lyrics);
        dispatch(setCurrentLyrics(lyrics));
        setSearchOpen(false);
      }
    } catch (error) {
      console.error('Apply lyrics failed:', error);
    } finally {
      setIsApplying(false);
    }
  };

  const handleSourceChange = (_: React.MouseEvent<HTMLElement>, newSource: LyricsSource | null) => {
    if (newSource) {
      setSearchSource(newSource);
      setSearchResults([]);
    }
  };

  const handleOpenSearch = () => {
    const match = track.title.match(/[【《]([^【】《》]+)[】》]/);
    const defaultQuery = match ? match[1] : track.title.split(/[-–—]/)[0].trim();
    setSearchQuery(defaultQuery);
    setSearchResults([]);
    setSearchOpen(true);
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 播放清單中的曲目
  const handlePlayFromList = (item: Track) => {
    apiService.recordChannelWatch(item.channel, item.thumbnail);
    dispatch(setPendingTrack(item));
    dispatch(setIsPlaying(true));
  };

  // 取得待播清單（當前索引之後的曲目）
  const upcomingTracks = playlist.slice(currentIndex + 1);

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
        {/* 頂部填充 */}
        <Box sx={{ height: '30vh' }} />
        {currentLyrics.lines.map((line, index) => {
          const isActive = currentLyrics.isSynced && index === currentLineIndex;
          const isPassed = currentLyrics.isSynced && index < currentLineIndex;

          return (
            <Box
              key={index}
              ref={(el: HTMLDivElement | null) => (lineRefs.current[index] = el)}
              onClick={() => currentLyrics.isSynced && handleLyricClick(line.time, index)}
              sx={{
                py: 2,
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
                sx={{
                  fontWeight: isActive ? 700 : 400,
                  fontSize: isActive ? '1.6rem' : '1.2rem',
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
        {/* 底部填充 */}
        <Box sx={{ height: '30vh' }} />
      </Box>
    );
  };

  // 渲染影片
  const renderVideo = () => {
    if (videoError) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', p: 2 }}>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {videoError}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            建議切換到「歌詞」或「封面」模式
          </Typography>
        </Box>
      );
    }

    return (
      <Box
        sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Box
          ref={videoContainerRef}
          sx={{
            width: '100%',
            maxWidth: 640,
            aspectRatio: '16/9',
          }}
        />
      </Box>
    );
  };

  // 渲染封面
  const renderCover = () => {
    return (
      <Box
        sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* 模糊背景 */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url(${track.thumbnail})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(30px) brightness(0.3)',
          }}
        />
        {/* 封面圖 */}
        <Box
          component="img"
          src={track.thumbnail}
          alt={track.title}
          sx={{
            position: 'relative',
            maxWidth: '80%',
            maxHeight: '60%',
            borderRadius: 2,
            boxShadow: 8,
          }}
        />
      </Box>
    );
  };

  // 渲染待播清單
  const renderUpcoming = () => {
    if (upcomingTracks.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
          沒有更多待播歌曲
        </Typography>
      );
    }

    return (
      <List dense sx={{ py: 0 }}>
        {upcomingTracks.slice(0, 10).map((item) => (
          <ListItem
            key={item.id}
            disablePadding
            secondaryAction={
              <IconButton edge="end" size="small" onClick={() => handlePlayFromList(item)}>
                <PlayArrowIcon fontSize="small" />
              </IconButton>
            }
          >
            <ListItemButton onClick={() => handlePlayFromList(item)} sx={{ py: 0.5 }}>
              <ListItemAvatar sx={{ minWidth: 48 }}>
                <Avatar
                  variant="rounded"
                  src={item.thumbnail}
                  sx={{ width: 40, height: 40 }}
                />
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Typography variant="body2" noWrap sx={{ fontSize: '0.85rem' }}>
                    {item.title}
                  </Typography>
                }
                secondary={
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {item.channel}
                  </Typography>
                }
              />
            </ListItemButton>
          </ListItem>
        ))}
        {upcomingTracks.length > 10 && (
          <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block', textAlign: 'center' }}>
            還有 {upcomingTracks.length - 10} 首歌曲
          </Typography>
        )}
      </List>
    );
  };

  return (
    <>
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            height: 'calc(100% - 140px)',
            maxHeight: 'calc(100% - 140px)',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            bottom: 140,
            display: 'flex',
            flexDirection: 'column',
          },
        }}
        ModalProps={{
          keepMounted: true,
          sx: {
            bottom: 140,
            height: 'calc(100% - 140px)',
            '& .MuiBackdrop-root': {
              bottom: 140,
            },
          },
        }}
      >
        {/* 頂部操作列 */}
        <Box
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            backgroundColor: 'background.paper',
            borderBottom: 1,
            borderColor: 'divider',
            px: 2,
            py: 1,
            flexShrink: 0,
          }}
        >
          {/* 下拉指示器 */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
            <Box
              sx={{
                width: 40,
                height: 4,
                backgroundColor: 'action.disabled',
                borderRadius: 2,
              }}
            />
          </Box>

          {/* 曲目資訊與關閉按鈕 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              component="img"
              src={track.thumbnail}
              alt={track.title}
              sx={{ width: 48, height: 48, borderRadius: 1, objectFit: 'cover' }}
            />
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
                {track.title}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {track.channel}
                </Typography>
                {currentLyrics && (
                  <Chip
                    label={currentLyrics.source === 'youtube' ? 'YT' :
                      currentLyrics.source === 'netease' ? '網易' :
                      currentLyrics.source === 'lrclib' ? 'LRC' :
                      currentLyrics.source === 'genius' ? 'G' : '?'}
                    size="small"
                    sx={{ height: 16, fontSize: '0.65rem' }}
                  />
                )}
              </Box>
            </Box>
            {viewMode === 'lyrics' && (
              <Tooltip title="搜尋其他歌詞">
                <IconButton size="small" onClick={handleOpenSearch}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <IconButton onClick={onClose}>
              <KeyboardArrowDownIcon />
            </IconButton>
          </Box>

          {/* 模式切換 */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
            <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={(_, newMode) => newMode && setViewMode(newMode)}
              size="small"
            >
              <ToggleButton value="lyrics">
                <LyricsIcon sx={{ mr: 0.5, fontSize: 18 }} />
                歌詞
              </ToggleButton>
              <ToggleButton value="video">
                <OndemandVideoIcon sx={{ mr: 0.5, fontSize: 18 }} />
                影片
              </ToggleButton>
              <ToggleButton value="cover">
                <AlbumIcon sx={{ mr: 0.5, fontSize: 18 }} />
                封面
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {/* 歌詞微調控制（僅在歌詞模式顯示） */}
          {viewMode === 'lyrics' && currentLyrics?.isSynced && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mt: 1 }}>
              {isFineTuning ? (
                <>
                  <Typography variant="caption" color="primary">滑動對準:</Typography>
                  <Chip
                    label={fineTuneOffset === 0 ? '0s' : `${fineTuneOffset > 0 ? '+' : ''}${fineTuneOffset.toFixed(1)}s`}
                    size="small"
                    color="primary"
                    sx={{ height: 20, minWidth: 50 }}
                  />
                  <IconButton size="small" onClick={handleConfirmFineTune} color="success">
                    <CheckIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  <IconButton size="small" onClick={handleCancelFineTune} color="error">
                    <CloseIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </>
              ) : (
                <>
                  <IconButton size="small" onClick={handleOffsetDecrease}>
                    <RemoveIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  <Chip
                    label={timeOffset === 0 ? '0s' : `${timeOffset > 0 ? '+' : ''}${timeOffset.toFixed(1)}s`}
                    size="small"
                    color={timeOffset === 0 ? 'default' : 'primary'}
                    sx={{ height: 20, minWidth: 50 }}
                  />
                  <IconButton size="small" onClick={handleOffsetIncrease}>
                    <AddIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  {timeOffset !== 0 && (
                    <IconButton size="small" onClick={handleOffsetReset}>
                      <RestartAltIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  )}
                  <IconButton size="small" onClick={handleEnterFineTune} color="primary">
                    <TuneIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </>
              )}
            </Box>
          )}
        </Box>

        {/* 主內容區域 */}
        <Box
          ref={viewMode === 'lyrics' ? lyricsContainerRef : undefined}
          onScroll={viewMode === 'lyrics' && isFineTuning ? handleFineTuneScroll : undefined}
          sx={{
            flex: 1,
            overflow: 'auto',
            position: 'relative',
            minHeight: 0,
            ...(viewMode === 'lyrics' && isFineTuning && {
              '&::before': {
                content: '""',
                position: 'fixed',
                top: '50%',
                left: 0,
                right: 0,
                height: '2px',
                backgroundColor: 'primary.main',
                opacity: 0.8,
                zIndex: 5,
                pointerEvents: 'none',
              },
            }),
          }}
        >
          {viewMode === 'lyrics' && renderLyrics()}
          {viewMode === 'video' && renderVideo()}
          {viewMode === 'cover' && renderCover()}
        </Box>

        {/* 待播清單 */}
        <Box
          sx={{
            borderTop: 1,
            borderColor: 'divider',
            backgroundColor: 'background.paper',
            maxHeight: '25%',
            overflow: 'auto',
            flexShrink: 0,
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1, display: 'block', fontWeight: 600 }}>
            待播清單 ({upcomingTracks.length})
          </Typography>
          {renderUpcoming()}
        </Box>
      </Drawer>

      {/* 歌詞搜尋對話框 */}
      <Dialog open={searchOpen} onClose={() => setSearchOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>搜尋歌詞</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2, mt: 1 }}>
            <ToggleButtonGroup
              value={searchSource}
              exclusive
              onChange={handleSourceChange}
              size="small"
            >
              <ToggleButton value="lrclib">LRCLIB</ToggleButton>
              <ToggleButton value="netease">網易雲音樂</ToggleButton>
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
                  <ListItemButton onClick={() => handleSelectLyrics(result)} disabled={isApplying}>
                    <ListItemText
                      primary={result.trackName}
                      secondaryTypographyProps={{ component: 'div' }}
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
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              onClick={handleReloadOriginalLyrics}
              disabled={isReloadingLyrics || isLoadingYouTubeCC}
              startIcon={isReloadingLyrics ? <CircularProgress size={16} /> : <RefreshIcon />}
              color="secondary"
              size="small"
            >
              自動搜尋
            </Button>
            <Button
              onClick={handleUseYouTubeCC}
              disabled={isLoadingYouTubeCC || isReloadingLyrics}
              startIcon={isLoadingYouTubeCC ? <CircularProgress size={16} /> : <ClosedCaptionIcon />}
              color="primary"
              variant="outlined"
              size="small"
            >
              YouTube CC
            </Button>
          </Box>
          <Button onClick={() => setSearchOpen(false)}>取消</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
