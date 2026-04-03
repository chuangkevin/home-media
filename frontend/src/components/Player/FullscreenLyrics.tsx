import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Drawer, CircularProgress, Alert, IconButton, Tooltip, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, List,
  ListItem, ListItemText, ListItemButton, InputAdornment, ToggleButtonGroup, ToggleButton,
  ListItemAvatar, Avatar, useMediaQuery
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
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store';
import type { Track } from '../../types/track.types';
import type { LyricsSearchResult, LyricsSource } from '../../types/lyrics.types';
import { setCurrentLineIndex, adjustTimeOffset, resetTimeOffset, setTimeOffset, setCurrentLyrics } from '../../store/lyricsSlice';
import { seekTo, setPendingTrack, setIsPlaying, clearSeekTarget, playNext } from '../../store/playerSlice';
import apiService from '../../services/api.service';
import lyricsCacheService from '../../services/lyrics-cache.service';
import { toTraditional } from '../../utils/chineseConvert';
import AudioPlayer from './AudioPlayer';
import PlayerControls from './PlayerControls';
import MorrorLyrics from './MorrorLyrics';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';

type ViewMode = 'lyrics' | 'video' | 'cover' | 'morror';

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
  const isLandscape = useMediaQuery('(orientation: landscape) and (min-width: 768px)');
  const isShortViewport = useMediaQuery('(max-height: 768px)');
  const { currentLyrics, isLoading, error, currentLineIndex, timeOffset } = useSelector(
    (state: RootState) => state.lyrics
  );
  const { currentTime, playlist, currentIndex, seekTarget } = useSelector((state: RootState) => state.player);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);

  // 顯示模式
  const [viewMode, setViewMode] = useState<ViewMode>('lyrics');
  const [isFullscreenLayout, setIsFullscreenLayout] = useState(false);
  const [isMorrorFullscreen, setIsMorrorFullscreen] = useState(false);

  // 歌詞翻譯
  const [translations, setTranslations] = useState<string[]>([]);
  const [translationError, setTranslationError] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const retryCountRef = useRef(0);
  const cancelledRef = useRef(false);

  // 影片快取狀態
  const [videoCached, setVideoCached] = useState(false);
  const [videoDownloading, setVideoDownloading] = useState(false);
  const [videoDownloadProgress, setVideoDownloadProgress] = useState('');

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
  const fineTuneStartTimeRef = useRef(0); // 進入微調時的播放時間（固定不變）
  const [isReloadingLyrics, setIsReloadingLyrics] = useState(false);

  // YouTube CC 載入狀態
  const [isLoadingYouTubeCC, setIsLoadingYouTubeCC] = useState(false);

  // 換曲目時立即清空翻譯（避免看到上一首的翻譯）
  useEffect(() => {
    setTranslations([]);
    setTranslationError(false);
    setIsTranslating(false);
  }, [track?.videoId]);

  // 翻譯邏輯：提取為 doTranslate，供 effect 和 retry button 共用
  const doTranslate = useCallback(() => {
    if (!currentLyrics || currentLyrics.lines.length === 0 || !track?.videoId) return;

    setIsTranslating(true);
    setTranslationError(false);

    const lines = currentLyrics.lines.map(l => l.text);
    apiService.translateLyrics(track.videoId, lines).then(result => {
      if (cancelledRef.current || !result) return;
      const trans = result.translations.map((t: string, i: number) => {
        if (!t || t === lines[i]) return '';
        return t;
      });
      const hasAny = trans.some((t: string) => t.length > 0);
      setTranslations(hasAny ? trans : []);
      setTranslationError(false);
      setIsTranslating(false);
    }).catch(() => {
      if (cancelledRef.current) return;
      // Gemini key cooldown 30 秒，間隔 15 秒重試最多 4 次（共 60 秒）
      if (retryCountRef.current < 4) {
        retryCountRef.current++;
        console.log(`🔄 翻譯重試 ${retryCountRef.current}/4（${retryCountRef.current * 15}s 後）`);
        setTimeout(doTranslate, 15000);
      } else {
        // 所有自動重試都失敗
        setTranslationError(true);
        setIsTranslating(false);
      }
    });
  }, [currentLyrics, track?.videoId]);

  // 歌詞翻譯：AI 辨識已帶翻譯就不重複翻；否則用 translateLyrics
  useEffect(() => {
    if (!currentLyrics || currentLyrics.lines.length === 0 || !track?.videoId) {
      setTranslations([]);
      return;
    }

    // AI 辨識的歌詞 (source='manual') 翻譯已存在 lyrics_translations 表
    // translateLyrics 會先查快取，有就直接用（不重新翻）
    cancelledRef.current = false;
    retryCountRef.current = 0;

    // 開始翻譯前先清空（避免新舊混合）
    setTranslations([]);

    doTranslate();
    return () => { cancelledRef.current = true; };
  }, [currentLyrics, track?.videoId, doTranslate]);

  // 手動重試翻譯
  const handleRetryTranslation = useCallback(() => {
    cancelledRef.current = false;
    retryCountRef.current = 0;
    setTranslationError(false);
    doTranslate();
  }, [doTranslate]);

  // 影片快取：開啟 Drawer 時自動開始下載，輪詢狀態
  const videoPollingVideoIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !track?.videoId) return;
    // 避免同一首歌重複觸發 polling
    if (videoPollingVideoIdRef.current === track.videoId && (videoCached || videoDownloading)) return;
    videoPollingVideoIdRef.current = track.videoId;
    let cancelled = false;

    (async () => {
      // 檢查是否已快取
      try {
        const status = await apiService.getVideoCacheStatus(track.videoId);
        if (cancelled) return;
        if (status.cached) { setVideoCached(true); setVideoDownloading(false); return; }
      } catch {
        if (cancelled) return;
      }

      // 觸發下載
      setVideoDownloading(true);
      setVideoCached(false);
      setVideoDownloadProgress('');
      apiService.downloadVideo(track.videoId).catch(() => {});

      // 輪詢等待下載完成
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 3000));
        if (cancelled) return;
        setVideoDownloadProgress(`下載中 ${(i + 1) * 3}s`);
        try {
          const status = await apiService.getVideoCacheStatus(track.videoId);
          if (status.cached) {
            setVideoCached(true);
            setVideoDownloading(false);
            setVideoDownloadProgress('');
            console.log(`🎬 影片下載完成: ${track.title}`);
            return;
          }
        } catch { /* continue */ }
      }
      setVideoDownloading(false);
      setVideoDownloadProgress('');
    })();

    return () => {
      cancelled = true;
    };
  }, [open, track?.videoId]);

  // 換歌時才重設影片快取狀態（不在 drawer 開關時重設）
  useEffect(() => {
    setVideoCached(false);
    setVideoDownloading(false);
    videoPollingVideoIdRef.current = null;
    apiService.videoCacheCleanup().catch(() => {});
  }, [track?.videoId]);

  // YouTube 播放器狀態
  const [videoReady, setVideoReady] = useState(false);
  const videoTimeSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 獲取播放狀態
  const { isPlaying: audioIsPlaying } = useSelector((state: RootState) => state.player);

  // 影片模式：audio element 持續播放（背景播放 + 鎖屏需要），YouTube iframe 靜音
  // AudioPlayer 的 displayMode effect 負責管理，FullscreenLyrics 不碰 audio element

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
    // setVideoError(null);
    setVideoReady(false);

    const initPlayer = () => {
      if (!isMounted || !videoContainerRef.current) return;

      if (window.YT && window.YT.Player) {
        // 建立 player 前取得 live audio 時間，用 start 參數讓 YouTube 從正確位置開始 buffer
        const audioEl = document.querySelector('audio') as HTMLAudioElement | null;
        const startTime = Math.floor(audioEl?.currentTime || currentTime);
        console.log(`🎬 建立 YouTube player, start=${startTime}s`);

        playerRef.current = new window.YT.Player(videoContainerRef.current, {
          videoId: track.videoId,
          playerVars: {
            autoplay: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            playsinline: 1,
            start: startTime, // 從 audio 位置開始 buffer（比 seekTo 可靠）
          },
          events: {
            onReady: (event: any) => {
              if (!isMounted) return;
              setVideoReady(true);
              event.target.mute();
              // 再次精確同步（start 只精確到秒）
              const liveTime = (document.querySelector('audio') as HTMLAudioElement | null)?.currentTime || currentTime;
              event.target.seekTo(liveTime, true);
              event.target.playVideo();
              console.log(`🎬 onReady: seekTo ${liveTime.toFixed(1)}s (start was ${startTime}s)`);
            },
            onStateChange: (event: any) => {
              if (!isMounted) return;
              const audioEl = document.querySelector('audio') as HTMLAudioElement | null;
              const audioTime = audioEl?.currentTime || 0;

              if (event.data === 1) {
                // iframe 開始播放 — 立即同步到 audio 位置
                const videoTime = event.target.getCurrentTime();
                if (Math.abs(videoTime - audioTime) > 1) {
                  console.log(`🎬 iframe playing, 同步: video=${videoTime.toFixed(1)}→audio=${audioTime.toFixed(1)}`);
                  event.target.seekTo(audioTime, true);
                }
              } else if (event.data === 2 || event.data === -1) {
                // iframe 暫停 — 如果 audio 在播放，強制 iframe 跟上
                if (audioEl && !audioEl.paused) {
                  event.target.seekTo(audioTime, true);
                  event.target.playVideo();
                }
              }
            },
            onError: (event: any) => {
              if (!isMounted) return;
              // YouTube 嵌入錯誤
              const errorCode = event.data;
              // setVideoErrorCode(errorCode);
              
              let errorMsg = '影片載入失敗';
              if (errorCode === 101 || errorCode === 150) {
                errorMsg = '此影片不允許嵌入播放';
              } else if (errorCode === 2) {
                errorMsg = '影片 ID 無效';
              } else if (errorCode === 5) {
                errorMsg = 'HTML5 播放器錯誤';
              } else if (errorCode === 100) {
                errorMsg = '找不到影片';
              }
              
              console.error(`🎬 YouTube 播放錯誤 (${errorCode}): ${errorMsg}`);
              // setVideoError(errorMsg);
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

  // 同步 iframe 位置到 audio element（audio 是唯一音源，iframe 跟隨）
  useEffect(() => {
    if (!videoReady || viewMode !== 'video' || !playerRef.current || !open) {
      if (videoTimeSyncRef.current) {
        clearInterval(videoTimeSyncRef.current);
        videoTimeSyncRef.current = null;
      }
      return;
    }

    // 首次同步：立即修正
    if (playerRef.current?.seekTo) {
      const audioEl = document.querySelector('audio') as HTMLAudioElement | null;
      const audioTime = audioEl?.currentTime || 0;
      if (audioTime > 0) {
        playerRef.current.seekTo(audioTime, true);
        console.log(`🎬 首次同步: seekTo ${audioTime.toFixed(1)}s`);
      }
    }

    let syncAttempts = 0;
    videoTimeSyncRef.current = setInterval(() => {
      if (playerRef.current && playerRef.current.getCurrentTime && playerRef.current.seekTo) {
        const videoTime = playerRef.current.getCurrentTime();
        const audioEl = document.querySelector('audio') as HTMLAudioElement | null;
        const audioTime = audioEl?.currentTime || 0;
        const drift = Math.abs(videoTime - audioTime);
        syncAttempts++;
        // 前 10 次無條件同步（iframe 剛載入時 getCurrentTime 可能不準）
        // 之後偏差超過 1 秒才修正
        if (drift > 1 || syncAttempts <= 10) {
          if (drift > 0.5) {
            playerRef.current.seekTo(audioTime, true);
            console.log(`🎬 同步 #${syncAttempts}: video=${videoTime.toFixed(1)}→audio=${audioTime.toFixed(1)} (drift=${drift.toFixed(1)}s)`);
          }
        }
      }
    }, 500);

    return () => {
      if (videoTimeSyncRef.current) {
        clearInterval(videoTimeSyncRef.current);
        videoTimeSyncRef.current = null;
      }
    };
  }, [videoReady, viewMode, open]);

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

  // 處理影片 seek 操作（拖動進度條）
  useEffect(() => {
    if (!videoReady || viewMode !== 'video' || !playerRef.current || seekTarget === null) return;

    try {
      console.log(`🎬 FullscreenLyrics: 影片跳轉到 ${seekTarget.toFixed(1)}s`);
      playerRef.current.seekTo(seekTarget, true);
      dispatch(clearSeekTarget());
    } catch (e) {
      console.error('🎬 影片跳轉失敗:', e);
    }
  }, [seekTarget, videoReady, viewMode, dispatch]);

  // cached <video> 同步：只在偏差過大時修正（避免頻繁 seek 導致轉圈）
  useEffect(() => {
    if (!open || viewMode !== 'video' || !videoCached) return;

    const syncInterval = setInterval(() => {
      const videoEl = document.querySelector('video') as HTMLVideoElement | null;
      const audioEl = document.querySelector('audio') as HTMLAudioElement | null;
      if (videoEl && audioEl && videoEl.readyState >= 2) {
        const drift = Math.abs(videoEl.currentTime - audioEl.currentTime);
        // 只在偏差超過 3 秒才修正（避免頻繁 seek 造成 buffering 轉圈）
        if (drift > 3) {
          videoEl.currentTime = audioEl.currentTime;
        }
      }
    }, 2000);

    return () => clearInterval(syncInterval);
  }, [open, viewMode, videoCached]);

  // 載入儲存的偏好設定（切歌時先 reset 再載入，避免殘留上一首的 offset）
  useEffect(() => {
    // 切歌時立即 reset offset（不管 drawer 開不開）
    dispatch(setTimeOffset(0));

    if (!open) return;

    const loadPreference = async () => {
      try {
        const backendPrefs = await apiService.getLyricsPreferences(track.videoId);
        if (backendPrefs?.timeOffset !== undefined && backendPrefs.timeOffset !== 0) {
          dispatch(setTimeOffset(backendPrefs.timeOffset));
          lyricsCacheService.setTimeOffset(track.videoId, backendPrefs.timeOffset);
          console.log(`🎯 載入歌詞偏移: ${backendPrefs.timeOffset}s (${track.videoId})`);
          return;
        }
      } catch (error) {
        console.warn('後端偏好載入失敗', error);
      }

      const localPref = await lyricsCacheService.getPreference(track.videoId);
      if (localPref?.timeOffset !== undefined && localPref.timeOffset !== 0) {
        dispatch(setTimeOffset(localPref.timeOffset));
        apiService.updateLyricsPreferences(track.videoId, { timeOffset: localPref.timeOffset });
        console.log(`🎯 載入歌詞偏移 (local): ${localPref.timeOffset}s (${track.videoId})`);
      }
    };
    loadPreference();
  }, [track.videoId, dispatch, open]);

  // 根據當前時間計算高亮歌詞行 — 用 rAF 直接讀 audio.currentTime（不依賴 Redux）
  useEffect(() => {
    if (!currentLyrics || !currentLyrics.isSynced || currentLyrics.lines.length === 0 || !open) {
      return;
    }

    const lines = currentLyrics.lines;
    let lastIndex = -1;
    let rafId: number;

    const tick = () => {
      const audio = document.querySelector('audio') as HTMLAudioElement;
      if (audio) {
        const adjustedTime = audio.currentTime + timeOffset;
        let newLineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
          if (adjustedTime >= lines[i].time) {
            newLineIndex = i;
          } else {
            break;
          }
        }
        if (newLineIndex !== lastIndex) {
          lastIndex = newLineIndex;
          dispatch(setCurrentLineIndex(newLineIndex));
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [currentLyrics, timeOffset, open, dispatch]);

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

  // 時間偏移控制（短按 ±0.5s，長按持續）
  const offsetIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyOffset = (delta: number) => {
    const newOffset = Math.round((timeOffset + delta) * 10) / 10;
    dispatch(adjustTimeOffset(delta));
    apiService.updateLyricsPreferences(track.videoId, { timeOffset: newOffset });
    lyricsCacheService.setTimeOffset(track.videoId, newOffset);
  };

  const handleOffsetIncrease = () => applyOffset(0.5);
  const handleOffsetDecrease = () => applyOffset(-0.5);

  // 長按持續調整
  const startHold = (delta: number) => {
    applyOffset(delta);
    offsetIntervalRef.current = setInterval(() => applyOffset(delta), 200);
  };
  const stopHold = () => {
    if (offsetIntervalRef.current) { clearInterval(offsetIntervalRef.current); offsetIntervalRef.current = null; }
  };

  const handleOffsetReset = () => {
    dispatch(resetTimeOffset());
    apiService.updateLyricsPreferences(track.videoId, { timeOffset: 0 });
    lyricsCacheService.setTimeOffset(track.videoId, 0);
  };

  // 微調模式
  const handleEnterFineTune = () => {
    // 記錄進入微調時的播放時間（之後不變，避免滾動時 offset 跳動）
    const audio = document.querySelector('audio') as HTMLAudioElement | null;
    fineTuneStartTimeRef.current = audio?.currentTime || currentTime;
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
      // 用進入微調時的固定時間計算（避免滾動時 offset 因音樂繼續播放而跳動）
      const refTime = fineTuneStartTimeRef.current;
      const newOffset = Math.round((lineTime - refTime) * 10) / 10;
      setFineTuneOffset(newOffset);
    }
  };

  // 重新載入歌詞
  const handleReloadOriginalLyrics = async () => {
    setIsReloadingLyrics(true);
    try {
      // 清除前端+後端快取，確保重新搜尋
      await lyricsCacheService.delete(track.videoId);
      await lyricsCacheService.clearPreference(track.videoId);
      await apiService.clearServerLyricsCache(track.videoId).catch(() => {});
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
    if (searchSource === 'ai') {
      // AI 模式：清掉快取，強制重新辨識
      setIsSearching(true);
      setSearchResults([]);
      try {
        // 先刪除舊的 AI 快取，強制重新辨識
        await apiService.deleteAILyricsCache(track.videoId).catch(() => {});
        const result = await apiService.generateAILyrics(track.videoId);
        if (result?.lines?.length > 0) {
          // 直接套用 AI 生成的歌詞
          const lyrics = {
            videoId: track.videoId,
            lines: result.lines,
            source: 'manual' as const,
            isSynced: true,
            language: result.language,
          };
          dispatch(setCurrentLyrics(lyrics));
          // 如果有翻譯，也設定
          if (result.translation?.length > 0) {
            setTranslations(result.translation.map((t: any) => t.text));
          }
          setSearchOpen(false);
          console.log(`🤖 AI 歌詞已套用: ${result.lines.length} 行 (${result.language})`);
        } else {
          console.warn('AI 歌詞生成失敗');
        }
      } catch (error) {
        console.error('AI lyrics generation failed:', error);
      } finally {
        setIsSearching(false);
      }
      return;
    }

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
        } else if (searchSource === 'netease') {
          apiService.updateLyricsPreferences(track.videoId, { neteaseId: result.id });
          await lyricsCacheService.setNeteaseId(track.videoId, result.id);
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
    // 簡單清理標題：移除 (Official Video) 等後綴
    const cleaned = track.title
      .replace(/\s*[\(\[【《].*?(official|mv|music video|lyric|lyrics|audio|hd|hq|4k|1080p|live).*?[\)\]】》]/gi, '')
      .replace(/\s*(official|mv|music video|lyrics?|lyric video|audio)$/gi, '')
      .trim();

    // 直接用清理後的標題作為搜尋預設值
    setSearchQuery(cleaned);
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

  // 完整播放清單（已播放灰色 + 目前高亮 + 待播正常）

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

    // 全螢幕橫向模式：更大的歌詞
    const isLandscapeFullscreen = isFullscreenLayout && isLandscape;

    return (
      <Box sx={{ 
        px: isLandscapeFullscreen ? 6 : 2,
        maxWidth: isLandscapeFullscreen ? '900px' : 'none',
        mx: 'auto',
        width: '100%',
      }}>
        {/* 頂部填充 */}
        <Box sx={{ height: isShortViewport ? '10vh' : '25vh' }} />
        {currentLyrics.lines.map((line, index) => {
          const isActive = currentLyrics.isSynced && index === currentLineIndex;
          const isPassed = currentLyrics.isSynced && index < currentLineIndex;

          return (
            <Box
              key={index}
              ref={(el: HTMLDivElement | null) => (lineRefs.current[index] = el)}
              onClick={() => currentLyrics.isSynced && handleLyricClick(line.time, index)}
              sx={{
                py: isLandscapeFullscreen ? 3 : 2,
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
                  fontSize: isLandscapeFullscreen 
                    ? (isActive ? '2.8rem' : '1.8rem')
                    : (isActive ? '1.6rem' : '1.2rem'),
                  color: isActive
                    ? 'primary.main'
                    : isPassed
                    ? 'text.secondary'
                    : 'text.primary',
                  opacity: isPassed ? 0.5 : 1,
                  transition: 'all 0.3s ease',
                  lineHeight: isLandscapeFullscreen ? 1.4 : 1.5,
                }}
              >
                {toTraditional(line.text)}
              </Typography>
              {/* 翻譯行 */}
              {translations[index] && translations[index] !== toTraditional(line.text) && (
                <Typography
                  sx={{
                    fontSize: isLandscapeFullscreen
                      ? (isActive ? '1.4rem' : '1rem')
                      : (isActive ? '0.95rem' : '0.8rem'),
                    color: isActive ? 'primary.light' : 'text.disabled',
                    opacity: isPassed ? 0.4 : 0.7,
                    mt: 0.3,
                    lineHeight: 1.3,
                    fontStyle: 'italic',
                  }}
                >
                  {translations[index]}
                </Typography>
              )}
            </Box>
          );
        })}
        {/* 翻譯重試 */}
        {translationError && !isTranslating && translations.length === 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <Chip
              icon={<RefreshIcon />}
              label="重試翻譯"
              onClick={handleRetryTranslation}
              variant="outlined"
              color="warning"
              sx={{ cursor: 'pointer' }}
            />
          </Box>
        )}
        {isTranslating && translations.length === 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={20} />
          </Box>
        )}
        {/* 底部填充 */}
        <Box sx={{ height: isShortViewport ? '10vh' : '25vh' }} />
      </Box>
    );
  };

  // 渲染影片（從快取播放 HTML5 video）
  const renderVideo = () => {
    if (!videoCached) {
      return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 2 }}>
          <CircularProgress />
          <Typography color="text.secondary">影片下載中...</Typography>
        </Box>
      );
    }

    return (
      <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
        <video
          src={apiService.getVideoCacheStreamUrl(track.videoId)}
          controls
          autoPlay
          playsInline
          style={{ width: '100%', maxHeight: '100%', maxWidth: 960 }}
          onCanPlay={(e) => {
            // 可以播放後同步到 audio 位置（只做一次）
            const videoEl = e.target as HTMLVideoElement;
            const audioEl = document.querySelector('audio') as HTMLAudioElement | null;
            if (audioEl && !videoEl.dataset.synced) {
              videoEl.dataset.synced = '1';
              videoEl.currentTime = audioEl.currentTime;
              console.log(`🎬 cached video 同步到 audio: ${audioEl.currentTime.toFixed(1)}s`);
            }
          }}
          onPause={() => {}}
          onEnded={() => dispatch(playNext())}
          muted
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

  // 渲染播放清單（已播放灰色 + 目前高亮 + 待播正常，過濾幽靈歌曲）
  const renderPlaylist = () => {
    if (playlist.length === 0 || playlist.every(t => !t.title || t.title === '載入中...')) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
          播放清單是空的
        </Typography>
      );
    }

    return (
      <List dense sx={{ py: 0 }}>
        {playlist.map((item, idx) => {
          // 跳過幽靈歌曲（未載入完的 placeholder）
          if (!item.title || item.title === '載入中...') return null;
          const isPlayed = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          return (
            <ListItem
              key={`${item.videoId}-${idx}`}
              disablePadding
              secondaryAction={
                !isCurrent ? (
                  <IconButton edge="end" size="small" onClick={() => handlePlayFromList(item)}>
                    <PlayArrowIcon fontSize="small" />
                  </IconButton>
                ) : undefined
              }
            >
              <ListItemButton
                onClick={() => !isCurrent && handlePlayFromList(item)}
                sx={{
                  py: 0.5,
                  opacity: isPlayed ? 0.45 : 1,
                  backgroundColor: isCurrent ? 'rgba(255,255,255,0.08)' : 'transparent',
                }}
              >
                <ListItemAvatar sx={{ minWidth: 48 }}>
                  <Avatar
                    variant="rounded"
                    src={item.thumbnail}
                    sx={{ width: 40, height: 40, opacity: isPlayed ? 0.5 : 1 }}
                  />
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{
                        fontSize: '0.85rem',
                        fontWeight: isCurrent ? 700 : 400,
                        color: isCurrent ? 'primary.main' : 'text.primary',
                      }}
                    >
                      {isCurrent ? '▶ ' : ''}{item.title}
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
          );
        })}
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
            height: (isFullscreenLayout || isMorrorFullscreen) ? '100%' : 'calc(100% - 160px - env(safe-area-inset-bottom, 0px))',
            maxHeight: (isFullscreenLayout || isMorrorFullscreen) ? '100%' : 'calc(100% - 160px - env(safe-area-inset-bottom, 0px))',
            borderTopLeftRadius: (isFullscreenLayout || isMorrorFullscreen) ? 0 : 16,
            borderTopRightRadius: (isFullscreenLayout || isMorrorFullscreen) ? 0 : 16,
            bottom: (isFullscreenLayout || isMorrorFullscreen) ? 0 : 'calc(160px + env(safe-area-inset-bottom, 0px))',
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            display: 'flex',
            flexDirection: isFullscreenLayout && isLandscape ? 'row' : 'column',
            pb: (isFullscreenLayout || isMorrorFullscreen) ? 0 : 3,
          },
        }}
        ModalProps={{
          keepMounted: true,
          sx: {
            bottom: (isFullscreenLayout || isMorrorFullscreen) ? 0 : 'calc(160px + env(safe-area-inset-bottom, 0px))',
            height: (isFullscreenLayout || isMorrorFullscreen) ? '100%' : 'calc(100% - 160px - env(safe-area-inset-bottom, 0px))',
            '& .MuiBackdrop-root': {
              bottom: (isFullscreenLayout || isMorrorFullscreen) ? 0 : 'calc(160px + env(safe-area-inset-bottom, 0px))',
            },
          },
        }}
      >
        {/* 橫式裝置：左側播放器 */}
        {isFullscreenLayout && isLandscape && (
          <Box
            sx={{
              width: 280,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderRight: 1,
              borderColor: 'divider',
              overflow: 'auto',
            }}
          >
            <AudioPlayer embedded />
          </Box>
        )}

        {/* 主歌詞區域 */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            minHeight: 0,
            position: 'relative',
          }}
        >
          {/* 頂部操作列 — 沉浸全螢幕時隱藏 */}
          {!isMorrorFullscreen && <Box
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
              <>
                <Tooltip title="搜尋其他歌詞">
                  <IconButton size="small" onClick={handleOpenSearch}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={isFullscreenLayout ? "退出全螢幕" : "全螢幕歌詞"}>
                  <IconButton size="small" onClick={() => setIsFullscreenLayout(!isFullscreenLayout)}>
                    {isFullscreenLayout ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
              </>
            )}
            <IconButton onClick={onClose}>
              <KeyboardArrowDownIcon />
            </IconButton>
          </Box>

          {/* 模式切換 */}
          {!isFullscreenLayout && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
              <ToggleButtonGroup
                value={viewMode}
                exclusive
                onChange={(_, newMode) => { if (newMode) { setViewMode(newMode); setIsMorrorFullscreen(false); } }}
                size="small"
              >
                <ToggleButton value="lyrics">
                  <LyricsIcon sx={{ mr: 0.5, fontSize: 18 }} />
                  歌詞
                </ToggleButton>
                <ToggleButton value="video" disabled={!videoCached}>
                  <OndemandVideoIcon sx={{ mr: 0.5, fontSize: 18 }} />
                  {videoDownloading ? videoDownloadProgress || '下載中...' : '影片'}
                </ToggleButton>
                <ToggleButton value="cover">
                  <AlbumIcon sx={{ mr: 0.5, fontSize: 18 }} />
                  封面
                </ToggleButton>
                <ToggleButton value="morror" disabled={!currentLyrics?.isSynced}>
                  <AutoAwesomeIcon sx={{ mr: 0.5, fontSize: 18 }} />
                  沉浸
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}

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
                  <IconButton size="small" onClick={handleOffsetDecrease}
                    onPointerDown={() => startHold(-0.5)} onPointerUp={stopHold} onPointerLeave={stopHold}
                  >
                    <RemoveIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                  <Chip
                    label={timeOffset === 0 ? '0s' : `${timeOffset > 0 ? '+' : ''}${timeOffset.toFixed(1)}s`}
                    size="small"
                    onClick={handleOffsetReset}
                    color={timeOffset === 0 ? 'default' : 'primary'}
                    sx={{ height: 24, minWidth: 55, cursor: 'pointer', fontWeight: 600 }}
                  />
                  <IconButton size="small" onClick={handleOffsetIncrease}
                    onPointerDown={() => startHold(0.5)} onPointerUp={stopHold} onPointerLeave={stopHold}
                  >
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
        </Box>}

        {/* 主內容區域 */}
        <Box
          ref={viewMode === 'lyrics' ? lyricsContainerRef : undefined}
          onScroll={viewMode === 'lyrics' && isFineTuning ? handleFineTuneScroll : undefined}
          sx={{
            flex: 1,
            overflow: 'auto',
            position: 'relative',
            minHeight: 0,
            // 捲軸樣式 - 確保可見
            '&::-webkit-scrollbar': { width: '6px' },
            '&::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(255,255,255,0.3)',
              borderRadius: '3px',
              '&:hover': { backgroundColor: 'rgba(255,255,255,0.5)' },
            },
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
          {isFullscreenLayout ? renderLyrics() : (
            <>
              {viewMode === 'lyrics' && renderLyrics()}
              {viewMode === 'video' && renderVideo()}
              {viewMode === 'cover' && renderCover()}
              {viewMode === 'morror' && currentLyrics?.isSynced && (
                <MorrorLyrics
                  lines={currentLyrics.lines}
                  currentLineIndex={currentLineIndex}
                  track={track}
                  timeOffset={timeOffset}
                  onFullscreenChange={setIsMorrorFullscreen}
                  translations={translations}
                  translationError={translationError}
                  isTranslating={isTranslating}
                  onRetryTranslation={handleRetryTranslation}
                />
              )}
            </>
          )}
        </Box>

        {/* 待播清單 - 非全螢幕且非沉浸全螢幕時顯示 */}
        {!isFullscreenLayout && !isMorrorFullscreen && (
          <Box
            sx={{
              borderTop: 1,
              borderColor: 'divider',
              backgroundColor: 'background.paper',
              maxHeight: '20%',
              overflow: 'auto',
              flexShrink: 0,
              pb: 3,
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1, display: 'block', fontWeight: 600 }}>
              播放清單 ({playlist.filter(t => t.title && t.title !== '載入中...').length})
            </Typography>
            {renderPlaylist()}
          </Box>
        )}

        {/* 直式裝置：底部迷你控制列（全螢幕模式） */}
        {isFullscreenLayout && !isLandscape && (
          <Box
            sx={{
              flexShrink: 0,
              borderTop: 1,
              borderColor: 'divider',
              px: 1.5,
              py: 1,
              backgroundColor: 'background.paper',
            }}
          >
            <PlayerControls isCompact />
          </Box>
        )}
      </Box>

      {/* 橫式裝置：右側播放清單 */}
      {isFullscreenLayout && isLandscape && (
        <Box
          sx={{
            width: 320,
            flexShrink: 0,
            borderLeft: 1,
            borderColor: 'divider',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'background.paper',
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1.5, display: 'block', fontWeight: 600, borderBottom: 1, borderColor: 'divider' }}>
            播放清單 ({playlist.filter(t => t.title && t.title !== '載入中...').length})
          </Typography>
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            {renderPlaylist()}
          </Box>
        </Box>
      )}
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
              <ToggleButton value="ai">🤖 AI</ToggleButton>
              <ToggleButton value="lrclib">LRCLIB</ToggleButton>
              <ToggleButton value="netease">網易雲音樂</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {searchSource === 'ai' ? (
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                AI 會分析音訊檔案，自動辨識歌詞並生成時間戳
              </Typography>
              <Button
                variant="contained"
                onClick={handleSearch}
                disabled={isSearching}
                startIcon={isSearching ? <CircularProgress size={16} /> : undefined}
              >
                {isSearching ? '辨識中...' : '🤖 開始 AI 辨識歌詞'}
              </Button>
            </Box>
          ) : (<>
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
          </>)}
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
