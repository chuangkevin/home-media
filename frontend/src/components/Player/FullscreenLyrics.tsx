import { getActivePlaybackAudio } from '../../services/active-audio';
import { createYouTubeVideoFollower } from '../../services/youtube-video-follower';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Typography, Drawer, CircularProgress, Alert, IconButton, Tooltip, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, List,
  ListItem, ListItemText, ListItemButton, InputAdornment, ToggleButtonGroup, ToggleButton,
  ListItemAvatar, Avatar, useMediaQuery
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import SearchIcon from '@mui/icons-material/Search';
import TuneIcon from '@mui/icons-material/Tune';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import LyricsIcon from '@mui/icons-material/Lyrics';
import OndemandVideoIcon from '@mui/icons-material/OndemandVideo';
import AlbumIcon from '@mui/icons-material/Album';
import ClosedCaptionIcon from '@mui/icons-material/ClosedCaption';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import { useSelector, useDispatch } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import type { Track } from '../../types/track.types';
import type { LyricsSearchResult, LyricsSource } from '../../types/lyrics.types';
import { setCurrentLineIndex, adjustTimeOffset, resetTimeOffset, setTimeOffset, setCurrentLyrics } from '../../store/lyricsSlice';
import { seekTo, setPendingTrack, setIsPlaying, reorderPlaylist, removeFromPlaylist, playNext } from '../../store/playerSlice';
import apiService from '../../services/api.service';
import lyricsCacheService from '../../services/lyrics-cache.service';
import { shouldUseCachedVideo, transitionCachedVideoFallback } from '../../services/cached-video-fallback';
import { seekFollowingVideo, isFollowingVideoSeek, finishFollowingVideoSeek } from '../../services/video-follow-seek';
import {
  claimVideoCachePolling,
  hasVideoCachePollingExpired,
  isVideoCacheProducerFailure,
  shouldRequestVideoCacheDownload,
  VIDEO_CACHE_POLL_INTERVAL_MS,
} from '../../services/video-cache-polling';
import { toTraditional } from '../../utils/chineseConvert';
import { useLyricsSync } from '../../hooks/useLyricsSync';
import AudioPlayer from './AudioPlayer';
import PlayerControls from './PlayerControls';
import MorrorLyrics from './MorrorLyrics';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
// DeleteOutlineIcon removed — swipe gesture replaced delete button
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import SwipeablePlaylistItem from './SwipeablePlaylistItem';
import { toggleFavorite } from '../../store/favoritesSlice';
import { blockItem } from '../../store/blockSlice';

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
  const dispatch = useDispatch<AppDispatch>();
  const isLandscape = useMediaQuery('(orientation: landscape) and (min-width: 480px) and (min-height: 360px)');
  const isUltrawide = useMediaQuery('(min-width: 1500px) and (orientation: landscape)');
  const isDesktop = useMediaQuery('(min-width: 768px) and (pointer: fine)'); // 滑鼠裝置
  const showLandscapeSidePanel = useMediaQuery('(min-width: 1024px) and (min-height: 560px)');
  const showQueueSidebar = useMediaQuery('(min-width: 1280px) and (min-height: 560px)');
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const isShortViewport = useMediaQuery('(max-height: 768px)');
  const { currentLyrics, isLoading, error, currentLineIndex, timeOffset } = useSelector(
    (state: RootState) => state.lyrics
  );
  const { currentTime, playlist, currentIndex, seekTarget } = useSelector((state: RootState) => state.player);
  const favoriteIds = useSelector((state: RootState) => state.favorites.favoriteIds);
  const { emitOffsetUpdate, emitSourceUpdate } = useLyricsSync(
    track.videoId,
    (receivedTranslations: string[]) => {
      const hasAny = receivedTranslations.some(t => t.length > 0);
      if (hasAny) {
        setTranslations(receivedTranslations);
        setIsTranslating(false);
        setTranslationError(false);
      }
    }
  );
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const cachedVideoRef = useRef<HTMLVideoElement | null>(null);
  const cachedVideoUserSeekingRef = useRef(false);
  const videoSyncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoNudgeResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHardSeekAtRef = useRef(0);
  const activeTrackVideoIdRef = useRef(track.videoId);
  activeTrackVideoIdRef.current = track.videoId;
  const isOpenRef = useRef(open);
  isOpenRef.current = open;

  // 顯示模式
  const [viewMode, setViewMode] = useState<ViewMode>('lyrics');
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const isFullscreenLayout = true;
  const [isMorrorFullscreen, setIsMorrorFullscreen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsSettingsOpen, setLyricsSettingsOpen] = useState(false);
  useEffect(() => {
    if (open) {
      setQueueOpen(showQueueSidebar);
      setLyricsSettingsOpen(false);
    }
  }, [open, showQueueSidebar]);

  // 橫向自動視為全螢幕佈局
  const effectiveFullscreen = isFullscreenLayout || isLandscape;

  // 歌詞翻譯
  const [translations, setTranslations] = useState<string[]>([]);
  const [translationError, setTranslationError] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const retryCountRef = useRef(0);
  const translationRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Swipe-down-to-dismiss gesture
  const [dragOffset, setDragOffset] = useState(0);
  const touchStartYRef = useRef(0);
  const isDraggingRef = useRef(false);
  // Translation generation counter: incremented each time a new translation starts.
  // In-flight requests from a previous generation are silently discarded.
  const translationGenRef = useRef(0);

  // 影片快取狀態
  const [videoCached, setVideoCached] = useState(false);
  const [videoCachedForId, setVideoCachedForId] = useState<string | null>(null);
  const [cachedVideoFallbackForId, setCachedVideoFallbackForId] = useState<string | null>(null);
  const [videoDownloading, setVideoDownloading] = useState(false);
  const [videoDownloadProgress, setVideoDownloadProgress] = useState('');
  const [videoDownloadError, setVideoDownloadError] = useState('');
  const [videoDownloadRetryVersion, setVideoDownloadRetryVersion] = useState(0);

  // 搜尋對話框狀態
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LyricsSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [searchSource, setSearchSource] = useState<LyricsSource>('lrclib');

  // 微調模式狀態
  const [isFineTuning, setIsFineTuning] = useState(false);
  const [fineTuneOffset, setFineTuneOffset] = useState(0);
  const fineTuneStartTimeRef = useRef(0); // 進入微調時的播放時間（固定不變）
  const [isReloadingLyrics, setIsReloadingLyrics] = useState(false);
  const [isRefreshingLyricsView, setIsRefreshingLyricsView] = useState(false);

  // Closing or rearranging the sheet discards only an unapplied calibration.
  useEffect(() => {
    setIsFineTuning(false);
    setFineTuneOffset(0);
  }, [open, showQueueSidebar, track.videoId]);

  // YouTube CC 載入狀態
  const [isLoadingYouTubeCC, setIsLoadingYouTubeCC] = useState(false);

  // 換曲目時立即清空翻譯（避免看到上一首的翻譯）
  useEffect(() => {
    if (translationRetryTimeoutRef.current) {
      clearTimeout(translationRetryTimeoutRef.current);
      translationRetryTimeoutRef.current = null;
    }
    // AudioPlayer owns the shared lyrics lifecycle. A lazy-mounted sheet must
    // retain lyrics that AudioPlayer has already loaded for this track.
    setTranslations([]);
    setTranslationError(false);
    setIsTranslating(false);
    translationGenRef.current += 1;
  }, [track?.videoId]);

  const clearLyricsViewState = useCallback(() => {
    if (translationRetryTimeoutRef.current) {
      clearTimeout(translationRetryTimeoutRef.current);
      translationRetryTimeoutRef.current = null;
    }
    translationGenRef.current += 1;
    retryCountRef.current = 0;
    setTranslations([]);
    setTranslationError(false);
    setIsTranslating(false);
  }, []);

  // 翻譯邏輯：提取為 doTranslate，供 effect 和 retry button 共用
  // gen: generation counter passed from caller — discards results from older generations
  const doTranslate = useCallback((gen: number) => {
    if (!currentLyrics || currentLyrics.lines.length === 0 || !track?.videoId) return;

    setIsTranslating(true);
    setTranslationError(false);

    const lines = currentLyrics.lines.map(l => l.text);
    const translateRequest = apiService.translateLyrics(track.videoId, lines);
    const fastTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('translation timeout')), 12000);
    });

    Promise.race([translateRequest, fastTimeout]).then(result => {
      if (translationGenRef.current !== gen) return; // stale
      if (!result) {
        throw new Error('Translation returned null');
      }
      const trans = result.translations.map((t: string, i: number) => {
        if (!t || t === lines[i]) return '';
        return t;
      });
      const hasAny = trans.some((t: string) => t.length > 0);
      if (!hasAny && retryCountRef.current < 4) {
        // 翻譯結果全空 — 自動 retry
        retryCountRef.current++;
        console.log(`🔄 翻譯結果為空，重試 ${retryCountRef.current}/4`);
        setTimeout(() => doTranslate(gen), 10000);
        return;
      }
      setTranslations(hasAny ? trans : []);
      setTranslationError(!hasAny);
      setIsTranslating(false);
    }).catch(() => {
      if (translationGenRef.current !== gen) return; // stale
      // 快速失敗 + 短暫重試，避免 UI 長時間卡在翻譯中
      if (retryCountRef.current < 1) {
        retryCountRef.current++;
        console.log(`🔄 翻譯重試 ${retryCountRef.current}/1（5s 後）`);
        translationRetryTimeoutRef.current = setTimeout(() => {
          translationRetryTimeoutRef.current = null;
          doTranslate(gen);
        }, 5000);
      } else {
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

    // 每次重新翻譯時遞增 generation，使所有舊的 in-flight 請求自動失效
    const gen = ++translationGenRef.current;
    retryCountRef.current = 0;

    // 開始翻譯前先清空（避免新舊混合）
    setTranslations([]);

    doTranslate(gen);
  }, [currentLyrics, track?.videoId, doTranslate]);

  // 手動重試翻譯
  const handleRetryTranslation = useCallback(() => {
    const gen = ++translationGenRef.current;
    retryCountRef.current = 0;
    setTranslationError(false);
    doTranslate(gen);
  }, [doTranslate]);

  // 影片快取：Drawer 開啟就開始下載（不限影片 tab），但輪詢是輕量 API call 不影響 iOS PWA
  const videoPollingVideoIdRef = useRef<string | null>(null);
  const videoId = track?.videoId;
  const showCachedVideo = shouldUseCachedVideo(videoCached, videoCachedForId, videoId, cachedVideoFallbackForId);
  const hasCachedVideoPlaybackError = cachedVideoFallbackForId === videoId;
  const handleRetryVideoDownload = useCallback(() => {
    // A retry is explicit: try the cached source once more, then fall back again
    // if the same file still cannot be decoded. Never auto-loop on media errors.
    setCachedVideoFallbackForId(current => transitionCachedVideoFallback(current, {
      type: 'cache-retry',
      videoId,
    }));
    setVideoDownloadError('');
    setVideoDownloadProgress('正在檢查影片快取…');
    setVideoDownloading(true);
    setVideoDownloadRetryVersion(version => version + 1);
  }, [videoId]);

  useEffect(() => {
    if (!open || !videoId) return;

    // Only one active poll per video; cleanup releases this claim so reopening
    // the drawer can restart the same video's polling lifecycle.
    const releasePolling = claimVideoCachePolling(videoPollingVideoIdRef, videoId);
    if (!releasePolling) return;
    let cancelled = false;
    let finished = false;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let serverDownloadInProgress = false;
    let shouldRequestDownload = true;

    (async () => {
      // 檢查是否已快取
      try {
        const status = await apiService.getVideoCacheStatus(videoId);
        if (cancelled) return;
        if (status.cached) {
          finished = true;
          if (retryTimeout) clearTimeout(retryTimeout);
          setVideoCached(true);
          setVideoCachedForId(videoId);
          setVideoDownloading(false);
          setVideoDownloadProgress('');
          setVideoDownloadError('');
          return;
        }
        serverDownloadInProgress = status.downloading;
        shouldRequestDownload = shouldRequestVideoCacheDownload(status);
      } catch {
        if (cancelled) return;
      }

      // 觸發下載
      setVideoDownloading(true);
      setVideoCached(false);
      setVideoCachedForId(null);
      setVideoDownloadProgress(serverDownloadInProgress ? '正在等待影片快取完成' : '正在準備影片快取…');
      setVideoDownloadError('');

      let downloadRetryCount = 0;
      const MAX_DOWNLOAD_RETRIES = 3;
      const RETRY_DELAYS = [2000, 5000, 10000];
      let downloadFailed = false;
      // An active producer found on reopen has already been accepted by the
      // server, so keep polling it instead of sending another POST.
      let downloadRequestAccepted = serverDownloadInProgress;

      const scheduleRetry = () => {
        downloadRetryCount++;
        if (downloadRetryCount <= MAX_DOWNLOAD_RETRIES) {
          const delay = RETRY_DELAYS[downloadRetryCount - 1] || 10000;
          retryTimeout = setTimeout(() => {
            retryTimeout = null;
            triggerDownload();
          }, delay);
          return true;
        }

        downloadFailed = true;
        return false;
      };

      const triggerDownload = () => {
        if (cancelled || finished) return;
        apiService.downloadVideo(videoId).then(() => {
          if (cancelled || finished) return;
          // POST responds 202 before yt-dlp finishes. Status polling decides
          // whether the producer actually completed successfully.
          downloadRequestAccepted = true;
        }).catch((err) => {
          if (cancelled || finished) return;
          const scheduled = scheduleRetry();
          if (scheduled) {
            const delay = RETRY_DELAYS[downloadRetryCount - 1] || 10000;
            console.warn(`🎬 Video download request failed (attempt ${downloadRetryCount}/${MAX_DOWNLOAD_RETRIES}), retrying in ${delay / 1000}s`);
          } else {
            console.error(`🎬 Video download failed after ${MAX_DOWNLOAD_RETRIES} retries:`, err);
          }
        });
      };
      if (shouldRequestDownload) triggerDownload();

      // 輪詢等待下載完成
      const pollingStartedAt = Date.now();
      while (!hasVideoCachePollingExpired(Date.now() - pollingStartedAt)) {
        await new Promise(r => setTimeout(r, VIDEO_CACHE_POLL_INTERVAL_MS));
        if (cancelled || finished) return;
        if (hasVideoCachePollingExpired(Date.now() - pollingStartedAt)) break;
        const elapsedSeconds = Math.ceil((Date.now() - pollingStartedAt) / 1000);
        setVideoDownloadProgress(`目前等候 ${elapsedSeconds} 秒`);
        try {
          const status = await apiService.getVideoCacheStatus(videoId);
          if (cancelled || finished) return;
          if (status.cached) {
            finished = true;
            if (retryTimeout) clearTimeout(retryTimeout);
            setVideoCached(true);
            setVideoCachedForId(videoId);
            setVideoDownloading(false);
            setVideoDownloadProgress('');
            setVideoDownloadError('');
            console.log(`🎬 影片下載完成: ${track.title}`);
            return;
          }

          // A successful 202 only acknowledges the request. If its producer
          // has already left the downloading state without a cache entry,
          // retry it with the same bounded backoff as request failures.
          if (isVideoCacheProducerFailure(status, downloadRequestAccepted)) {
            downloadRequestAccepted = false;
            if (!scheduleRetry()) {
              console.error(`🎬 Video download producer failed after ${MAX_DOWNLOAD_RETRIES} retries`);
            }
          }

          if (downloadFailed && !status.downloading) {
            finished = true;
            if (retryTimeout) clearTimeout(retryTimeout);
            setVideoDownloading(false);
            setVideoDownloadProgress('');
            setVideoDownloadError('下載失敗，請稍後重試');
            console.warn(`🎬 影片下載中止: ${track.title}`);
            return;
          }
        } catch { /* continue */ }
      }
      if (cancelled || finished) return;
      finished = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      setVideoDownloading(false);
      setVideoDownloadProgress('');
      setVideoDownloadError('下載逾時，請稍後重試');
    })();

    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      releasePolling();
    };
  }, [open, videoId, videoDownloadRetryVersion]);

  // 換歌時才重設影片快取狀態（不在 drawer 開關時重設）
  useEffect(() => {
    setVideoCached(false);
    setVideoCachedForId(null);
    setCachedVideoFallbackForId(current => transitionCachedVideoFallback(current, { type: 'track-change' }));
    setVideoDownloading(false);
    setVideoDownloadProgress('');
    setVideoDownloadError('');
    setVideoReady(false);
    if (cachedVideoRef.current) {
      delete cachedVideoRef.current.dataset.synced;
    }
    cachedVideoUserSeekingRef.current = false;
    apiService.videoCacheCleanup().catch(() => {});
  }, [track?.videoId]);

  // YouTube 播放器狀態
  const [videoReady, setVideoReady] = useState(false);
  const videoTimeSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 獲取播放狀態
  const { isPlaying: audioIsPlaying } = useSelector((state: RootState) => state.player);
  const [iframeAutoplayBlocked, setIframeAutoplayBlocked] = useState(false);
  const iframePlayingRef = useRef(audioIsPlaying);
  iframePlayingRef.current = audioIsPlaying;
  const iframeFollowerRef = useRef<ReturnType<typeof createYouTubeVideoFollower> | null>(null);
  const iframeGenerationRef = useRef(0);

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
    if (!open || viewMode !== 'video' || showCachedVideo || !videoContainerRef.current) {
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
    const generation = ++iframeGenerationRef.current;
    let ownedPlayer: any = null;
    const isCurrent = () => isMounted && iframeGenerationRef.current === generation
      && isOpenRef.current && viewModeRef.current === 'video'
      && activeTrackVideoIdRef.current === track.videoId;
    const follower = createYouTubeVideoFollower({
      isCurrent, getPlayer: () => playerRef.current,
      getPlaying: () => iframePlayingRef.current,
      onBlockedChange: setIframeAutoplayBlocked,
    });
    iframeFollowerRef.current = follower;
    setIframeAutoplayBlocked(false);
    // setVideoError(null);
    setVideoReady(false);

    const initPlayer = () => {
      if (!isCurrent() || ownedPlayer || !videoContainerRef.current) return;

      if (window.YT && window.YT.Player) {
        // 建立 player 前取得 live audio 時間，用 start 參數讓 YouTube 從正確位置開始 buffer
        const audioEl = getActivePlaybackAudio() as HTMLAudioElement | null;
        const startTime = Math.floor(audioEl?.currentTime ?? currentTime);
        console.log(`🎬 建立 YouTube player, start=${startTime}s`);

        ownedPlayer = new window.YT.Player(videoContainerRef.current, {
          videoId: track.videoId,
          playerVars: {
            autoplay: 0,
            mute: 1,
            enablejsapi: 1,
            origin: window.location.origin,
            playsinline: 1,
            start: startTime, // 從 audio 位置開始 buffer（比 seekTo 可靠）
          },
          events: {
            onReady: (event: any) => {
              if (!follower.onReady(event)) return;
              setVideoReady(true);
            },
            onStateChange: follower.onStateChange,
            onAutoplayBlocked: follower.onAutoplayBlocked,
            onError: (event: any) => {
              if (!isCurrent() || event.target !== ownedPlayer) return;
              follower.dispose();
              setVideoReady(false);
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
        playerRef.current = ownedPlayer;
      }
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      isMounted = false;
      follower.dispose();
      if (iframeFollowerRef.current === follower) iframeFollowerRef.current = null;
      if (playerRef.current === ownedPlayer) playerRef.current = null;
      ownedPlayer?.destroy?.();
      if (window.onYouTubeIframeAPIReady === initPlayer) window.onYouTubeIframeAPIReady = () => {};
      setVideoReady(false);
    };
  }, [open, viewMode, showCachedVideo, track.videoId]);

  // 同步 iframe 位置到 audio element（audio 是唯一音源，iframe 跟隨）
  useEffect(() => {
    if (!videoReady || viewMode !== 'video' || !playerRef.current || !open) {
      if (videoTimeSyncRef.current) {
        clearInterval(videoTimeSyncRef.current);
        videoTimeSyncRef.current = null;
      }
      return;
    }

    iframeFollowerRef.current?.tick();
    videoTimeSyncRef.current = setInterval(() => iframeFollowerRef.current?.tick(), 500);

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

    iframeFollowerRef.current?.tick();
  }, [audioIsPlaying, videoReady, viewMode]);

  // 快取影片模式：高準度同步（音樂場景目標 < 200ms）
  // - 每 0.8 秒檢查，避免長時間漂移
  // - 優先用 playbackRate 鎖相，僅在偏差過大時 hard seek
  useEffect(() => {
    const clearSyncTimers = () => {
      if (videoSyncIntervalRef.current) {
        clearInterval(videoSyncIntervalRef.current);
        videoSyncIntervalRef.current = null;
      }
      if (videoNudgeResetRef.current) {
        clearTimeout(videoNudgeResetRef.current);
        videoNudgeResetRef.current = null;
      }
    };

    if (!open || viewMode !== 'video' || !showCachedVideo || !cachedVideoRef.current) {
      clearSyncTimers();
      if (cachedVideoRef.current) {
        cachedVideoRef.current.playbackRate = 1;
      }
      cachedVideoUserSeekingRef.current = false;
      return;
    }

    const syncOnce = () => {
      const videoEl = cachedVideoRef.current;
      const audioEl = getActivePlaybackAudio() as HTMLAudioElement | null;
      if (!videoEl || !audioEl) return;
      if (videoEl.readyState < 2 || audioEl.readyState < 2 || videoEl.seeking || audioEl.seeking) return;

      if (cachedVideoUserSeekingRef.current) return;

      // 恢復鎖：剛從鎖屏/背景回來時跳過同步，讓影片先 buffer
      if (recoveryLockRef.current) return;

      // 先對齊播放/暫停狀態
      if (!audioEl.paused && videoEl.paused) {
        videoEl.play().catch(() => {});
      } else if (audioEl.paused && !videoEl.paused) {
        videoEl.pause();
        videoEl.playbackRate = 1;
        return;
      }

      if (audioEl.paused) return;

      const drift = audioEl.currentTime - videoEl.currentTime;
      const absDrift = Math.abs(drift);

      // 大偏差：冷卻後才 hard seek，避免一直轉圈
      if (absDrift >= 0.7) {
        const now = Date.now();
        if (now - lastHardSeekAtRef.current > 4500) {
          try {
            seekFollowingVideo(videoEl, audioEl.currentTime);
            videoEl.playbackRate = 1;
            lastHardSeekAtRef.current = now;
            console.log(`🎬 [CachedVideo] hard sync: ${drift.toFixed(2)}s`);
          } catch {}
        }
        return;
      }

      // 中小偏差：用速度微調，不做 seek
      if (absDrift >= 0.10) {
        // 比例控制：偏差越大，調整越強；限制在 0.96~1.04 以減少音高體感
        const k = 0.06;
        const unclamped = 1 + drift * k;
        const targetRate = Math.max(0.96, Math.min(1.04, unclamped));
        if (Math.abs(videoEl.playbackRate - targetRate) > 0.001) {
          videoEl.playbackRate = targetRate;
        }
        if (videoNudgeResetRef.current) {
          clearTimeout(videoNudgeResetRef.current);
        }
        videoNudgeResetRef.current = setTimeout(() => {
          if (cachedVideoRef.current) {
            cachedVideoRef.current.playbackRate = 1;
          }
        }, 1200);
      } else if (Math.abs(videoEl.playbackRate - 1) > 0.001) {
        videoEl.playbackRate = 1;
      }
    };

    syncOnce();
    videoSyncIntervalRef.current = setInterval(syncOnce, 600);

    return () => {
      clearSyncTimers();
      if (cachedVideoRef.current) {
        cachedVideoRef.current.playbackRate = 1;
      }
    };
  }, [open, viewMode, showCachedVideo, track.videoId]);

  // iOS/PWA 背景時關閉可視影片層，讓 audio 持續播放並降低整頁被回收的機率。
  const recoveryLockRef = useRef(false);
  useEffect(() => {
    const handleVisibilityChange = () => {
      const videoEl = cachedVideoRef.current;
      const audioEl = getActivePlaybackAudio() as HTMLAudioElement | null;
      if (!videoEl || viewMode !== 'video') return;

      if (document.hidden) {
        videoEl.pause();
        videoEl.playbackRate = 1;
        return;
      }

      // 回到前景：設定恢復鎖，給影片充分的緩衝時間
      recoveryLockRef.current = true;
      console.log('🎬 FullscreenLyrics 回到前景，暫停同步 3 秒');

      if (audioEl) {
        try {
          // 先 seek 到 audio 的位置（影片還是暫停狀態，不會卡）
          seekFollowingVideo(videoEl, audioEl.currentTime);
        } catch {}

        // 延遲播放 — 等影片 buffer 好再開始，避免解鎖瞬間卡頓
        setTimeout(() => {
          const ve = cachedVideoRef.current;
          const ae = getActivePlaybackAudio() as HTMLAudioElement | null;
          if (ve && ae && !ae.paused) {
            try { seekFollowingVideo(ve, ae.currentTime); } catch {}
            ve.play().catch(() => {});
          }
          // 再給 1 秒才解除恢復鎖，讓影片穩定播放後 sync interval 才介入
          setTimeout(() => { recoveryLockRef.current = false; }, 1000);
        }, 2000);
      } else {
        setTimeout(() => { recoveryLockRef.current = false; }, 3000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [viewMode]);

  // 處理影片 seek 操作（拖動進度條）
  useEffect(() => {
    if (seekTarget === null || viewMode !== 'video') return;

    try {
      if (showCachedVideo && cachedVideoRef.current) {
        seekFollowingVideo(cachedVideoRef.current, seekTarget);
      } else if (videoReady) {
        // Follow the active audio owner's completed seek through the same
        // readiness/buffering/paused-state guard as periodic synchronization.
        iframeFollowerRef.current?.tick();
      }
    } catch (e) {
      console.error('🎬 影片跳轉失敗:', e);
    }
  }, [seekTarget, videoReady, viewMode, showCachedVideo]);

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
      const audio = getActivePlaybackAudio() as HTMLAudioElement;
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
        behavior: reduceMotion ? 'auto' : 'smooth',
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
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    }
  };

  // 時間偏移控制（短按 ±0.5s，長按持續）

  const applyOffset = (delta: number) => {
    const newOffset = Math.round((timeOffset + delta) * 10) / 10;
    dispatch(adjustTimeOffset(delta));
    apiService.updateLyricsPreferences(track.videoId, { timeOffset: newOffset });
    lyricsCacheService.setTimeOffset(track.videoId, newOffset);
    emitOffsetUpdate(track.videoId, newOffset);
  };

  const handleOffsetIncrease = () => applyOffset(0.5);
  const handleOffsetDecrease = () => applyOffset(-0.5);

  const handleOffsetReset = () => {
    dispatch(resetTimeOffset());
    apiService.updateLyricsPreferences(track.videoId, { timeOffset: 0 });
    lyricsCacheService.setTimeOffset(track.videoId, 0);
    emitOffsetUpdate(track.videoId, 0);
  };

  // 微調模式
  const handleEnterFineTune = () => {
    // 記錄進入微調時的播放時間（之後不變，避免滾動時 offset 跳動）
    const audio = getActivePlaybackAudio() as HTMLAudioElement | null;
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
    emitOffsetUpdate(track.videoId, newOffset);
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
    setIsRefreshingLyricsView(true);
    try {
      clearLyricsViewState();
      // 清除前端+後端快取，確保重新搜尋
      await lyricsCacheService.delete(track.videoId);
      await lyricsCacheService.clearPreference(track.videoId);
      await apiService.clearServerLyricsCache(track.videoId).catch(() => {});
      apiService.updateLyricsPreferences(track.videoId, { timeOffset: 0, lrclibId: null });

      const lyrics = await apiService.getLyrics(track.videoId, track.title, track.channel);

      if (lyrics && activeTrackVideoIdRef.current === track.videoId) {
        await lyricsCacheService.set(track.videoId, lyrics);
        dispatch(setCurrentLyrics(lyrics));
        dispatch(resetTimeOffset());
        emitSourceUpdate(track.videoId, 'auto', null);
        emitOffsetUpdate(track.videoId, 0);
      } else if (activeTrackVideoIdRef.current === track.videoId) {
        dispatch(setCurrentLyrics(null));
      }

      setSearchOpen(false);
    } catch (error) {
      setSearchError('重新載入歌詞失敗，請稍後重試。');
      console.error('Reload lyrics failed:', error);
    } finally {
      setIsRefreshingLyricsView(false);
      setIsReloadingLyrics(false);
    }
  };

  // 使用 YouTube CC 字幕
  const handleUseYouTubeCC = async () => {
    setIsLoadingYouTubeCC(true);
    setIsRefreshingLyricsView(true);
    try {
      clearLyricsViewState();
      const lyrics = await apiService.getYouTubeCaptions(track.videoId);

      if (lyrics && activeTrackVideoIdRef.current === track.videoId) {
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
      setIsRefreshingLyricsView(false);
      setIsLoadingYouTubeCC(false);
    }
  };

  // 搜尋歌詞
  const handleSearch = async () => {
    if (isSearching) return;
    if (searchSource !== 'ai' && !searchQuery.trim()) return;
    setSearchError('');
    setHasSearched(true);
    if (searchSource === 'ai') {
      // AI 模式：清掉快取，強制重新辨識
      setIsSearching(true);
      setIsRefreshingLyricsView(true);
      setSearchResults([]);
      try {
        clearLyricsViewState();
        // 先刪除舊的 AI 快取，強制重新辨識
        await apiService.deleteAILyricsCache(track.videoId).catch(() => {});
        const result = await apiService.generateAILyrics(track.videoId);
        if (result?.lines?.length > 0 && activeTrackVideoIdRef.current === track.videoId) {
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
          setSearchError('這次未能辨識出歌詞，請重試或選擇其他來源。');
          console.warn('AI 歌詞生成失敗');
        }
      } catch (error) {
        setSearchError('AI 辨識暫時無法使用，請稍後重試。');
        console.error('AI lyrics generation failed:', error);
      } finally {
        setIsRefreshingLyricsView(false);
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
      setSearchError('暫時無法搜尋歌詞，請稍後重試。');
      console.error('Search lyrics failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // 選擇歌詞
  const handleSelectLyrics = async (result: LyricsSearchResult) => {
    setIsApplying(true);
    setIsRefreshingLyricsView(true);
    try {
      clearLyricsViewState();
      const lyrics = searchSource === 'netease'
        ? await apiService.getLyricsByNeteaseId(track.videoId, result.id)
        : await apiService.getLyricsByLRCLIBId(track.videoId, result.id);

      if (lyrics && activeTrackVideoIdRef.current === track.videoId) {
        if (searchSource === 'lrclib') {
          apiService.updateLyricsPreferences(track.videoId, { lrclibId: result.id });
          await lyricsCacheService.setLrclibId(track.videoId, result.id);
        } else if (searchSource === 'netease') {
          apiService.updateLyricsPreferences(track.videoId, { neteaseId: result.id });
          await lyricsCacheService.setNeteaseId(track.videoId, result.id);
        }
        await lyricsCacheService.set(track.videoId, lyrics);
        dispatch(setCurrentLyrics(lyrics));
        emitSourceUpdate(track.videoId, searchSource, result.id);
        setSearchOpen(false);
      }
    } catch (error) {
      setSearchError('無法套用這份歌詞，請重試或選擇其他結果。');
      console.error('Apply lyrics failed:', error);
    } finally {
      setIsRefreshingLyricsView(false);
      setIsApplying(false);
    }
  };

  const handleSourceChange = (_: React.MouseEvent<HTMLElement>, newSource: LyricsSource | null) => {
    if (newSource) {
      setSearchSource(newSource);
      setHasSearched(false);
      setSearchError('');
      setSearchResults([]);
    }
  };

  const handleOpenSearch = () => {
    setHasSearched(false);
    setSearchError('');
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

  // 拖曳排序
  const handleDragEnd = (result: any) => {
    if (!result.destination) return;
    dispatch(reorderPlaylist({ fromIndex: result.source.index, toIndex: result.destination.index }));
  };

  // 自動捲動到正在播放的曲目
  const currentTrackRef = useRef<HTMLDivElement | null>(null);
  const currentVideoId = playlist[currentIndex]?.videoId;
  useEffect(() => {
    if (open && currentTrackRef.current) {
      setTimeout(() => {
        currentTrackRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      }, 300);
    }
  }, [open, queueOpen, currentIndex, currentVideoId, reduceMotion]);

  // 完整播放清單（已播放灰色 + 目前高亮 + 待播正常）

  // 渲染歌詞
  const renderLyrics = () => {
    if (isLoading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress aria-label="歌詞載入中" />
        </Box>
      );
    }

    if (isRefreshingLyricsView) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress aria-label="重新載入歌詞" />
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
        <Box sx={{ textAlign: 'center', px: 3, py: 6 }}>
          <Typography variant="h6" sx={{ fontSize: '1.125rem', mb: 1 }}>還沒找到這首歌的歌詞</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>音樂會繼續播放。你可以換個關鍵字或歌詞來源。</Typography>
          <Button variant="outlined" startIcon={<SearchIcon />} onClick={handleOpenSearch}>搜尋歌詞</Button>
        </Box>
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

    return (
      <Box sx={{ 
        px: { xs: 1.5, sm: 3 },
        maxWidth: 900,
        mx: 'auto',
        width: '100%',
      }}>
        {/* 頂部填充 - Ultrawide 縮減填充 */}
        <Box sx={{ height: isShortViewport ? '12vh' : '20vh' }} />
        {currentLyrics.lines.map((line, index) => {
          const isActive = currentLyrics.isSynced && index === currentLineIndex;
          const isPassed = currentLyrics.isSynced && index < currentLineIndex;

          return (
            <Box
              key={index}
              ref={(el: HTMLDivElement | null) => (lineRefs.current[index] = el)}
              onClick={() => currentLyrics.isSynced && handleLyricClick(line.time, index)}
              role={currentLyrics.isSynced ? 'button' : undefined}
              tabIndex={currentLyrics.isSynced ? 0 : undefined}
              aria-label={currentLyrics.isSynced ? `跳至歌詞：${toTraditional(line.text)}` : undefined}
              aria-current={isActive ? 'true' : undefined}
              onKeyDown={(event) => {
                if (currentLyrics.isSynced && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  handleLyricClick(line.time, index);
                }
              }}
              sx={{
                py: { xs: 1.75, sm: 2.5 },
                px: 2,
                textAlign: 'center',
                transition: 'color 0.2s ease, background-color 0.2s ease',
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
                  fontSize: { xs: '1.25rem', sm: '1.5rem', lg: '1.75rem', xl: '2rem' },
                  color: isActive
                    ? 'primary.main'
                    : isPassed
                    ? 'text.secondary'
                    : 'text.primary',
                  opacity: 1,
                  transition: 'all 0.3s ease',
                  lineHeight: 1.6,
                }}
              >
                {toTraditional(line.text)}
              </Typography>
              {/* 翻譯行 */}
              {translations[index] && translations[index] !== toTraditional(line.text) && (
                <Typography
                  sx={{
                    fontSize: { xs: '0.875rem', sm: '1rem', lg: '1.125rem' },
                    color: 'text.secondary',
                    opacity: 1,
                    mt: isUltrawide ? 0.1 : 0.3,
                    lineHeight: 1.2,
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
              sx={{ cursor: 'pointer', minHeight: 44 }}
            />
          </Box>
        )}
        {isTranslating && translations.length === 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={20} />
          </Box>
        )}
        {/* 底部填充 */}
        <Box sx={{ height: isShortViewport ? '12vh' : '20vh' }} />
      </Box>
    );
  };

  // 渲染影片（從快取播放 HTML5 video 或 YouTube IFrame fallback）
  const renderVideo = () => {
    const currentLineText = currentLyrics?.lines?.[currentLineIndex]?.text || '';
    const currentLineTranslation = translations[currentLineIndex] || '';
    const videoStatusError = videoDownloadError || (hasCachedVideoPlaybackError ? '快取影片無法播放' : '');

    return (
      <Box sx={{ width: '100%', height: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
        {!showCachedVideo && (videoDownloading || videoStatusError) && (
          <Box
            role={videoStatusError ? 'alert' : 'status'}
            aria-live={videoStatusError ? 'assertive' : 'polite'}
            sx={{
              position: 'absolute', top: { xs: 8, sm: 16 }, left: '50%', transform: 'translateX(-50%)',
              zIndex: 12, display: 'flex', alignItems: 'center', gap: 1, width: 'max-content',
              maxWidth: 'calc(100% - 24px)', minHeight: 44, px: 1.5, py: 0.75,
              color: 'common.white', bgcolor: 'rgba(0, 0, 0, 0.78)', borderRadius: 2,
              boxShadow: 2, pointerEvents: videoStatusError ? 'auto' : 'none',
            }}
          >
            {videoDownloading && <CircularProgress size={18} color="inherit" aria-label="影片快取進度" />}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                {hasCachedVideoPlaybackError ? '快取影片無法播放' : videoDownloadError ? '影片快取失敗' : '影片快取中'}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'rgba(255,255,255,0.82)', lineHeight: 1.3 }}>
                {hasCachedVideoPlaybackError
                  ? `${videoReady ? '已切換至 YouTube 備援影片' : 'YouTube 備援影片載入中'}，不影響音訊控制`
                  : videoDownloadError
                    ? `${videoDownloadError}。${videoReady ? 'YouTube 備援影片仍可播放' : 'YouTube 備援影片載入中，不影響音訊控制'}`
                    : (videoReady ? 'YouTube 備援影片仍可播放' : 'YouTube 備援影片載入中，不影響音訊控制')}
                {videoDownloading && videoDownloadProgress && (
                  <Box component="span" aria-hidden="true"> · {videoDownloadProgress}</Box>
                )}
              </Typography>
            </Box>
            {videoStatusError && !videoDownloading && (
              <Button
                color="inherit"
                variant="outlined"
                onClick={handleRetryVideoDownload}
                aria-label={hasCachedVideoPlaybackError ? '重試快取影片' : '重試影片快取'}
                sx={{ minWidth: 72, minHeight: 44, whiteSpace: 'nowrap' }}
              >
                重試
              </Button>
            )}
          </Box>
        )}
        {showCachedVideo && (
          <video
            key={`cached-video-${track.videoId}`}
            ref={cachedVideoRef}
            src={apiService.getVideoCacheStreamUrl(track.videoId)}
            controls
            autoPlay={viewMode === 'video'}
            playsInline
            style={{
              width: '100%', maxHeight: '100%', maxWidth: 960, zIndex: 1,
              display: viewMode === 'video' ? 'block' : 'none',
            }}
            onCanPlay={(e) => {
              const videoEl = e.currentTarget;
              if (
                cachedVideoRef.current !== videoEl || !isOpenRef.current ||
                viewModeRef.current !== 'video' || activeTrackVideoIdRef.current !== track.videoId
              ) return;
              const audioEl = getActivePlaybackAudio() as HTMLAudioElement | null;
              if (audioEl && !videoEl.dataset.synced) {
                videoEl.dataset.synced = '1';
                seekFollowingVideo(videoEl, audioEl.currentTime);
                console.log(`🎬 cached video 同步到 audio: ${audioEl.currentTime.toFixed(1)}s`);
              }
            }}
            onError={(event) => {
              const videoId = track.videoId;
              // Ignore an event delivered after close or after this element was
              // replaced by another track's cached video.
              if (
                cachedVideoRef.current !== event.currentTarget ||
                !isOpenRef.current ||
                activeTrackVideoIdRef.current !== videoId
              ) return;

              setCachedVideoFallbackForId(current => transitionCachedVideoFallback(current, {
                type: 'cache-error',
                error: {
                  videoId,
                  activeVideoId: activeTrackVideoIdRef.current,
                  isOpen: isOpenRef.current,
                },
              }));
            }}
            onSeeking={(e) => {
              const videoEl = e.currentTarget;
              if (
                cachedVideoRef.current !== videoEl || !isOpenRef.current ||
                viewModeRef.current !== 'video' || activeTrackVideoIdRef.current !== track.videoId ||
                isFollowingVideoSeek(videoEl)
              ) return;
              cachedVideoUserSeekingRef.current = true;
              dispatch(seekTo(videoEl.currentTime));
            }}
            onSeeked={(e) => {
              const videoEl = e.currentTarget;
              finishFollowingVideoSeek(videoEl);
              if (cachedVideoRef.current === videoEl && !videoEl.seeking) {
                cachedVideoUserSeekingRef.current = false;
              }
            }}
            onPause={() => {}}
            muted
          />
        )}
        {!showCachedVideo && (
          <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
            <div
              key={`yt-video-${track.videoId}`}
              ref={videoContainerRef}
              style={{
                width: '100%',
                height: '100%',
                zIndex: 1,
              }}
            />
            {iframeAutoplayBlocked && (
              <Box sx={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 2, textAlign: 'center', bgcolor: 'rgba(0,0,0,0.8)', p: 1, color: 'white' }}>
                <Typography role="status" variant="body2">瀏覽器暫停了影片自動播放，音樂仍由音訊播放器控制。</Typography>
                <Button color="inherit" aria-label="重試影片播放" sx={{ minHeight: 44 }} onClick={() => {
                  dispatch(setIsPlaying(true));
                  iframeFollowerRef.current?.retryOnGesture();
                }}>點擊播放影片</Button>
              </Box>
            )}
            {!videoReady && (
              <Box sx={{ position: 'absolute', top: '50%', left: '50%', width: 'calc(100% - 48px)', maxWidth: 400, transform: 'translate(-50%, -50%)', color: 'white', zIndex: 2, textAlign: 'center' }}>
                <CircularProgress color="inherit" aria-label="YouTube 備援影片載入中" />
                <Typography role="status" variant="body2" sx={{ display: 'block', mt: 1 }}>
                  正在載入 YouTube 備援影片…
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', color: 'rgba(255,255,255,0.78)', mt: 1 }}>不影響音訊控制，你可以隨時返回歌詞。</Typography>
                <Button color="inherit" variant="outlined" onClick={() => setViewMode('lyrics')} sx={{ mt: 2 }}>返回歌詞</Button>
              </Box>
            )}
          </Box>
        )}

        {/* 字幕疊加層 (Subtitles Overlay) - 對兩種模式皆有效 */}
        {currentLineText && (
          <Box
            sx={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: effectiveFullscreen ? 40 : 18,
              zIndex: 10, // 確保在 IFrame 之上
              pointerEvents: 'none',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <Box
              sx={{
                maxWidth: '92%',
                px: 1.5,
                py: 0.9,
                borderRadius: 1.5,
                backgroundColor: 'rgba(0,0,0,0.62)',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                textAlign: 'center',
              }}
            >
              <Typography
                variant="subtitle1"
                sx={{
                  color: 'white',
                  fontWeight: 700,
                  lineHeight: 1.35,
                  textShadow: '0 2px 8px rgba(0,0,0,0.7)',
                  fontSize: effectiveFullscreen ? '1.4rem' : '1.1rem'
                }}
              >
                {toTraditional(currentLineText)}
              </Typography>
              {currentLineTranslation && (
                <Typography
                  variant="body2"
                  sx={{
                    color: 'rgba(255,255,255,0.82)',
                    mt: 0.35,
                    lineHeight: 1.35,
                    textShadow: '0 2px 8px rgba(0,0,0,0.7)',
                    fontSize: effectiveFullscreen ? '1.1rem' : '0.9rem'
                  }}
                >
                  {currentLineTranslation}
                </Typography>
              )}
            </Box>
          </Box>
        )}
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
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="playlist">
          {(provided) => (
            <List dense={!isUltrawide} sx={{ py: 0 }} ref={provided.innerRef} {...provided.droppableProps}>
              {playlist.map((item, idx) => {
                // 跳過幽靈歌曲（未載入完的 placeholder）
                if (!item.title || item.title === '載入中...') return null;
                const isCurrent = idx === currentIndex;
                return (
                  <Draggable key={`${item.videoId}-${idx}`} draggableId={`${idx}-${item.videoId}`} index={idx}>
                    {(dragProvided, dragSnapshot) => (
                      <div
                        ref={(el: HTMLDivElement | null) => {
                          dragProvided.innerRef(el);
                          if (isCurrent && el) currentTrackRef.current = el;
                        }}
                        {...dragProvided.draggableProps}
                      >
                      <SwipeablePlaylistItem
                        trackTitle={item.title}
                        isFavorited={!!favoriteIds[item.videoId]}
                        isDesktop={isDesktop}
                        onSwipeRight={() => dispatch(toggleFavorite({
                          videoId: item.videoId, title: item.title,
                          channel: item.channel, thumbnail: item.thumbnail, duration: item.duration,
                        }))}
                        onRemove={() => {
                          if (isCurrent) dispatch(playNext());
                          dispatch(removeFromPlaylist(idx));
                        }}
                        onBlock={() => {
                          if (isCurrent) dispatch(playNext());
                          dispatch(removeFromPlaylist(idx));
                          dispatch(blockItem({
                            type: 'song', videoId: item.videoId,
                            title: item.title, thumbnail: item.thumbnail,
                          }));
                        }}
                      >
                      <ListItem
                        disablePadding
                        sx={{
                          borderLeft: isCurrent ? '3px solid' : '3px solid transparent',
                          borderLeftColor: isCurrent ? 'primary.main' : 'transparent',
                          ...(dragSnapshot.isDragging && {
                            backgroundColor: 'action.selected',
                            boxShadow: 4,
                            borderRadius: 1,
                          }),
                        }}
                      >
                        <Box
                          {...dragProvided.dragHandleProps}
                          aria-label={`拖曳排序：${item.title}`}
                          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, minHeight: 44, flexShrink: 0, cursor: 'grab', color: 'text.secondary' }}
                        >
                          <DragIndicatorIcon fontSize="small" />
                        </Box>
                        <ListItemButton
                          onClick={() => !isCurrent && handlePlayFromList(item)}
                          aria-label={`${isCurrent ? '正在播放' : '播放'}：${item.title}`}
                          aria-current={isCurrent ? 'true' : undefined}
                          sx={{
                            py: 1,
                            px: 1,
                            opacity: 1,
                            backgroundColor: isCurrent ? 'action.selected' : 'transparent',
                            minHeight: 64,
                            minWidth: 0,
                          }}
                        >
                          <ListItemAvatar sx={{ minWidth: 48 }}>
                            <Avatar
                              variant="rounded"
                              src={item.thumbnail}
                              sx={{ width: 40, height: 40 }}
                            />
                          </ListItemAvatar>
                          <ListItemText
                            primary={
                              <Typography
                                variant="body2"
                                noWrap
                                sx={{
                                  fontSize: '0.875rem',
                                  fontWeight: isCurrent ? 700 : 400,
                                  color: isCurrent ? 'primary.main' : 'text.primary',
                                }}
                              >
                                {isCurrent ? '▶ ' : ''}{item.title}
                              </Typography>
                            }
                            secondary={
                              <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: '0.75rem' }}>
                                {item.channel}
                              </Typography>
                            }
                          />
                        </ListItemButton>
                      </ListItem>
                      </SwipeablePlaylistItem>
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </List>
          )}
        </Droppable>
      </DragDropContext>
    );
  };

  // Reset drag offset when drawer opens/closes
  useEffect(() => {
    setDragOffset(0);
    isDraggingRef.current = false;
  }, [open]);

  const handleHeaderTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
    isDraggingRef.current = false;
  }, []);

  const handleHeaderTouchMove = useCallback((e: React.TouchEvent) => {
    const delta = e.touches[0].clientY - touchStartYRef.current;
    if (delta > 0) {
      isDraggingRef.current = true;
      setDragOffset(delta);
    }
  }, []);

  const handleHeaderTouchEnd = useCallback(() => {
    if (dragOffset > 80) {
      onClose();
    }
    setDragOffset(0);
    isDraggingRef.current = false;
  }, [dragOffset, onClose]);

  return (
    <>
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        PaperProps={{
          role: 'dialog',
          'aria-modal': true,
          'aria-label': `正在播放：${track.title}`,
          sx: {
            height: 'var(--app-dvh, 100dvh)',
            maxHeight: 'var(--app-dvh, 100dvh)',
            borderRadius: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: showLandscapeSidePanel ? 'row' : 'column',
            overflow: 'hidden',
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
            transition: isDraggingRef.current || reduceMotion ? 'none' : 'transform 0.25s ease',
          },
        }}
        ModalProps={{ keepMounted: true }}
      >
        {showLandscapeSidePanel && !isMorrorFullscreen && (
          <Box component="aside" aria-label="目前歌曲與播放控制" sx={{
            width: { lg: 252, xl: 288 }, minWidth: 240, flexShrink: 0,
            borderRight: 1, borderColor: 'divider', overflow: 'auto',
          }}>
            <AudioPlayer embedded />
          </Box>
        )}

        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {!isMorrorFullscreen && (
            <Box sx={{ flexShrink: 0, backgroundColor: 'background.paper', borderBottom: 1, borderColor: 'divider', px: { xs: 1.5, sm: 2.5 }, pb: 1 }}>
              <Box
                onTouchStart={handleHeaderTouchStart}
                onTouchMove={handleHeaderTouchMove}
                onTouchEnd={handleHeaderTouchEnd}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 1, touchAction: 'none' }}
              >
                <Box sx={{ minWidth: 0, flex: 1, pr: 0.5 }}>
                  <Typography variant="subtitle1" noWrap title={track.title} sx={{ fontSize: { xs: '0.9375rem', sm: '1.125rem' }, fontWeight: 700, lineHeight: 1.4 }}>
                    {track.title}
                  </Typography>
                  <Typography variant="caption" noWrap component="p" sx={{ fontSize: '0.75rem', color: 'text.secondary', lineHeight: 1.4 }}>
                    {track.channel}
                  </Typography>
                </Box>
                <Tooltip title="歌詞設定">
                  <IconButton aria-label="歌詞設定" aria-expanded={lyricsSettingsOpen} aria-controls="lyrics-settings"
                    color={lyricsSettingsOpen ? 'primary' : 'default'} onClick={() => {
                      if (lyricsSettingsOpen) handleCancelFineTune();
                      setLyricsSettingsOpen(!lyricsSettingsOpen);
                    }}>
                    <TuneIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={`待播清單（${playlist.length} 首）`}>
                  <IconButton aria-label={`待播清單（${playlist.length} 首）`} aria-expanded={queueOpen}
                    color={queueOpen ? 'primary' : 'default'} onClick={() => setQueueOpen(!queueOpen)}>
                    <QueueMusicIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="收起播放器">
                  <IconButton aria-label="收起播放器" onClick={onClose}><KeyboardArrowDownIcon /></IconButton>
                </Tooltip>
              </Box>
              <ToggleButtonGroup
                value={viewMode} exclusive aria-label="播放器顯示模式"
                onChange={(_, newMode) => { if (newMode) { handleCancelFineTune(); setViewMode(newMode); setIsMorrorFullscreen(false); } }}
                sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', width: '100%',
                  '& .MuiToggleButton-root': { minWidth: 0, minHeight: 44, px: 0.5, py: 1, whiteSpace: 'nowrap', fontSize: '0.875rem', gap: 0.5 },
                  '& .MuiSvgIcon-root': { fontSize: 18, flexShrink: 0 },
                }}
              >
                <ToggleButton value="lyrics"><LyricsIcon />歌詞</ToggleButton>
                <ToggleButton value="video" aria-busy={videoDownloading}><OndemandVideoIcon />影片</ToggleButton>
                <ToggleButton value="cover"><AlbumIcon />封面</ToggleButton>
                <ToggleButton value="morror" disabled={!currentLyrics?.isSynced}><AutoAwesomeIcon />沉浸</ToggleButton>
              </ToggleButtonGroup>
              {lyricsSettingsOpen && (
                <Box id="lyrics-settings" sx={{ pt: 1.5, maxHeight: '32dvh', overflowY: 'auto' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      {currentLyrics ? `歌詞來源：${currentLyrics.source === 'lrclib' ? 'LRCLIB' : currentLyrics.source === 'netease' ? '網易雲音樂' : currentLyrics.source === 'youtube' ? 'YouTube CC' : currentLyrics.source}` : '找不到合適的歌詞？'}
                    </Typography>
                    <Button startIcon={<SearchIcon />} onClick={handleOpenSearch}>搜尋其他歌詞</Button>
                  </Box>
                  {currentLyrics?.isSynced && (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                      <Typography variant="caption" sx={{ width: '100%', textAlign: 'center', fontSize: '0.75rem', color: 'text.secondary' }}>
                        {isFineTuning ? '滑動歌詞，將正在唱的那句移到中線。' : '歌詞與聲音不同步時，以 0.5 秒微調。'}
                      </Typography>
                      {isFineTuning ? (
                        <>
                          <Chip label={`${fineTuneOffset > 0 ? '+' : ''}${fineTuneOffset.toFixed(1)} 秒`} color="primary" />
                          <Button startIcon={<CheckIcon />} onClick={handleConfirmFineTune}>套用</Button>
                          <Button onClick={handleCancelFineTune}>取消</Button>
                        </>
                      ) : (
                        <>
                          <IconButton aria-label="歌詞延後 0.5 秒" onClick={handleOffsetDecrease}><RemoveIcon /></IconButton>
                          <Button aria-label="重設歌詞時間偏移" onClick={handleOffsetReset} sx={{ minWidth: 72, fontVariantNumeric: 'tabular-nums' }}>
                            {timeOffset > 0 ? '+' : ''}{timeOffset.toFixed(1)} 秒
                          </Button>
                          <IconButton aria-label="歌詞提前 0.5 秒" onClick={handleOffsetIncrease}><AddIcon /></IconButton>
                          <Button startIcon={<TuneIcon />} onClick={handleEnterFineTune}>滑動對準</Button>
                        </>
                      )}
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          )}

          <Box
            ref={viewMode === 'lyrics' ? lyricsContainerRef : undefined}
            onScroll={viewMode === 'lyrics' && isFineTuning ? handleFineTuneScroll : undefined}
            aria-label={viewMode === 'lyrics' ? '歌曲歌詞' : undefined}
            sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'auto', overscrollBehavior: 'contain',
              '&::-webkit-scrollbar': { width: 6 },
              '&::-webkit-scrollbar-thumb': { backgroundColor: 'action.disabled', borderRadius: 3 },
              ...(viewMode === 'lyrics' && isFineTuning && { '&::before': {
                content: '""', position: 'sticky', display: 'block', top: '50%', height: 2,
                backgroundColor: 'primary.main', opacity: 0.8, zIndex: 5, pointerEvents: 'none',
              } }),
            }}
          >
            {viewMode === 'lyrics' && renderLyrics()}
            {viewMode === 'video' && renderVideo()}
            {viewMode === 'cover' && renderCover()}
            {viewMode === 'morror' && currentLyrics?.isSynced && (
              <MorrorLyrics
                lines={currentLyrics.lines} currentLineIndex={currentLineIndex} track={track} timeOffset={timeOffset}
                onFullscreenChange={setIsMorrorFullscreen} translations={translations}
                translationError={translationError} isTranslating={isTranslating} onRetryTranslation={handleRetryTranslation}
              />
            )}
          </Box>
          {!showLandscapeSidePanel && !isMorrorFullscreen && (
            <Box sx={{ flexShrink: 0, px: { xs: 2, sm: 3 }, py: 1, borderTop: 1, borderColor: 'divider', backgroundColor: 'background.paper' }}>
              <PlayerControls isCompact />
            </Box>
          )}
        </Box>

        {showQueueSidebar && queueOpen && !isMorrorFullscreen && (
          <Box component="aside" aria-label="待播清單" sx={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0, borderLeft: 1, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
              <Box><Typography fontWeight={700}>待播清單</Typography><Typography variant="caption" color="text.secondary">{playlist.filter(t => t.title && t.title !== '載入中...').length} 首歌曲</Typography></Box>
              <IconButton aria-label="收起待播清單" onClick={() => setQueueOpen(false)}><CloseIcon /></IconButton>
            </Box>
            <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>{renderPlaylist()}</Box>
          </Box>
        )}
      </Drawer>

      <Drawer anchor="bottom" open={open && queueOpen && !showQueueSidebar && !isMorrorFullscreen} onClose={() => setQueueOpen(false)}
        PaperProps={{ role: 'dialog', 'aria-modal': true, 'aria-label': '待播清單', sx: {
          maxHeight: '75dvh', borderRadius: '20px 20px 0 0', pb: 'env(safe-area-inset-bottom, 0px)',
          width: '100%', maxWidth: 640, mx: 'auto',
        } }}>
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }}>
          <Box><Typography fontWeight={700}>待播清單</Typography><Typography variant="caption" color="text.secondary">{playlist.filter(t => t.title && t.title !== '載入中...').length} 首歌曲・可拖曳排序</Typography></Box>
          <IconButton aria-label="關閉待播清單" onClick={() => setQueueOpen(false)}><CloseIcon /></IconButton>
        </Box>
        <Box sx={{ overflow: 'auto', minHeight: 0 }}>{renderPlaylist()}</Box>
      </Drawer>


      {/* 歌詞搜尋對話框 */}
      <Dialog open={searchOpen} onClose={() => setSearchOpen(false)} maxWidth="sm" fullWidth aria-labelledby="fullscreen-lyrics-search-title">
        <DialogTitle id="fullscreen-lyrics-search-title">搜尋歌詞</DialogTitle>
        <DialogContent>
          {searchError && <Alert severity="error" sx={{ mb: 2 }}>{searchError}</Alert>}
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2, mt: 1 }}>
            <ToggleButtonGroup
              value={searchSource}
              exclusive
              onChange={handleSourceChange}
              size="small" aria-label="歌詞搜尋來源"
              sx={{ width: '100%', '& .MuiToggleButton-root': { flex: 1, whiteSpace: 'nowrap', minWidth: 0, px: 1 } }}
            >
              <ToggleButton value="ai">AI</ToggleButton>
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
                {isSearching ? '辨識中...' : '開始 AI 辨識歌詞'}
              </Button>
            </Box>
          ) : (<>
          <TextField
            autoFocus
            fullWidth
            label="輸入歌名或關鍵字"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                handleSearch();
              }
            }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton aria-label="搜尋歌詞" onClick={handleSearch} disabled={isSearching}>
                    {isSearching ? <CircularProgress size={20} /> : <SearchIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          {isSearching && <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 3 }}><CircularProgress size={20} /><Typography variant="body2">正在搜尋歌詞…</Typography></Box>}
          {hasSearched && !isSearching && !searchError && searchResults.length === 0 && <Typography role="status" variant="body2" color="text.secondary" sx={{ py: 3 }}>沒有找到歌詞，試試歌名、歌手或其他來源。</Typography>}
          {searchResults.length > 0 && (
            <List sx={{ mt: 2, maxHeight: 300, overflow: 'auto' }}>
              {searchResults.map((result) => (
                <ListItem key={result.id} disablePadding>
                  <ListItemButton onClick={() => handleSelectLyrics(result)} disabled={isApplying}>
                    <ListItemText
                      primary={result.trackName}
                      secondaryTypographyProps={{ component: 'div' }}
                      secondary={
                        <Box component="span" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
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
