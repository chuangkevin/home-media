import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Card, CardContent, Typography, CardMedia, CircularProgress, Button, Chip, IconButton, Snackbar } from '@mui/material';
import LyricsIcon from '@mui/icons-material/Lyrics';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CloudIcon from '@mui/icons-material/Cloud';
import StorageIcon from '@mui/icons-material/Storage';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import PlayerControls from './PlayerControls';
import { RootState } from '../../store';
import { setIsPlaying, setCurrentTime, setDuration, clearSeekTarget, playNext, playPrevious, confirmPendingTrack, cancelPendingTrack } from '../../store/playerSlice';
import { setCurrentLyrics, setIsLoading as setLyricsLoading, setError as setLyricsError } from '../../store/lyricsSlice';
import apiService from '../../services/api.service';
import audioCacheService from '../../services/audio-cache.service';
import lyricsCacheService from '../../services/lyrics-cache.service';
import { useAutoQueue } from '../../hooks/useAutoQueue';
import AddToPlaylistMenu from '../Playlist/AddToPlaylistMenu';

interface AudioPlayerProps {
  onOpenLyrics?: () => void;
  embedded?: boolean; // 是否為嵌入模式（用於全螢幕歌詞）
}

export default function AudioPlayer({ onOpenLyrics, embedded = false }: AudioPlayerProps) {
  const dispatch = useDispatch();
  const audioRef = useRef<HTMLAudioElement>(null);
  const { currentTrack, pendingTrack, isLoadingTrack, isPlaying, volume, displayMode, seekTarget, playlist, currentIndex, currentTime } = useSelector((state: RootState) => state.player);
  // isCompactPlayer removed - mini player is always compact now
  const [isLoading, setIsLoading] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const currentVideoIdRef = useRef<string | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const pendingBlobUrlRef = useRef<string | null>(null);
  const lastAudioSrcRef = useRef<string | null>(null);
  const lastAudioTimeRef = useRef<number>(0);
  const wasCompletedRef = useRef(false);
  const completeSentRef = useRef(false);

  // 🎵 自動播放佇列 - 當接近播放清單尾端時自動加入推薦歌曲
  useAutoQueue();
  const lastAudioMutedRef = useRef<boolean>(false);
  const isPlayingRef = useRef(isPlaying);
  const displayModeRef = useRef(displayMode);

  // 快取狀態
  const [isCached, setIsCached] = useState(false);
  const [cacheToast, setCacheToast] = useState(false);

  // SponsorBlock 跳過片段
  const [skipToast, setSkipToast] = useState('');
  const skipSegmentsRef = useRef<Array<{ start: number; end: number; category: string }>>([]);
  const lastSkipRef = useRef(0); // 防止重複跳過同一段

  // 播放清單選單狀態
  const [playlistMenuAnchor, setPlaylistMenuAnchor] = useState<null | HTMLElement>(null);

  // 保持 isPlayingRef 同步
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // 保持 displayModeRef 同步
  useEffect(() => {
    displayModeRef.current = displayMode;
  }, [displayMode]);

  // SponsorBlock: 載入跳過片段
  useEffect(() => {
    if (!currentTrack?.videoId) return;
    skipSegmentsRef.current = [];
    lastSkipRef.current = 0;
    apiService.getSponsorBlockSegments(currentTrack.videoId).then(segments => {
      if (segments.length > 0) {
        skipSegmentsRef.current = segments;
        console.log(`🚫 [SponsorBlock] ${segments.length} skip segments for ${currentTrack.videoId}`);
      }
    });
  }, [currentTrack?.videoId]);

  // 當有 pendingTrack 時，預載音訊（不切換 UI）
  useEffect(() => {
    if (!pendingTrack || !audioRef.current) return;

    // Record skip signal if previous track was not completed and played less than 50%
    if (audioRef.current && currentVideoIdRef.current && !wasCompletedRef.current) {
      const audio = audioRef.current;
      if (audio.duration > 0 && audio.currentTime < audio.duration * 0.5) {
        apiService.recordSkip(currentVideoIdRef.current).catch(() => {});
      }
    }
    wasCompletedRef.current = false;
    completeSentRef.current = false;

    const videoId = pendingTrack.videoId;

    // 如果 pending 和 current 相同，直接確認
    if (currentTrack && currentVideoIdRef.current === videoId) {
      console.log(`⏭️ Same track, confirming: ${pendingTrack.title}`);
      dispatch(confirmPendingTrack());
      return;
    }

    console.log(`🔄 Pending track: ${pendingTrack.title} (${videoId}), preparing...`);
    setIsLoading(true);

    const loadPendingAudio = async () => {
      try {
        // 重置快取狀態
        setIsCached(false);

        // 🚀 優先檢查前端 IndexedDB 快取（最快！）
        const browserCached = await audioCacheService.get(videoId);
        
        if (browserCached) {
          // ✅ 前端有 cache，直接用 Blob URL 播放（秒開！）
          const blobUrl = URL.createObjectURL(browserCached);
          console.log(`⚡ 從瀏覽器快取播放（秒開）: ${pendingTrack.title}`);
          setIsCached(true);
          
          // 設定 audio src 並立即播放
          audioRef.current!.src = blobUrl;
          audioRef.current!.load();
          
          // 背景觸發後端預加載（不等待）
          apiService.preloadAudio(videoId).catch(() => {});
          
          // 確認切換
          dispatch(confirmPendingTrack());
          setIsLoading(false);
          
          // 🎵 快取路徑也需要載入歌詞！
          (async () => {
            dispatch(setLyricsLoading(true));
            try {
              // 1. 先檢查使用者是否有儲存特定的歌詞選擇（優先從後端 API 獲取，跨裝置同步）
              let lrclibId: number | null = null;
              let neteaseId: number | null = null;
              try {
                console.log(`🔍 查詢後端歌詞偏好: ${videoId}`);
                const backendPrefs = await apiService.getLyricsPreferences(videoId);
                console.log(`📦 後端回應:`, backendPrefs);
                if (backendPrefs?.lrclibId) {
                  lrclibId = backendPrefs.lrclibId;
                  console.log(`📝 從後端獲取 LRCLIB ID: ${lrclibId}`);
                }
                if (backendPrefs?.neteaseId) {
                  neteaseId = backendPrefs.neteaseId;
                  console.log(`📝 從後端獲取 NetEase ID: ${neteaseId}`);
                }
              } catch (error) {
                // 後端獲取失敗，fallback 到本地
                console.log(`⚠️ 後端獲取失敗，使用本地快取 preference`, error);
                const localPref = await lyricsCacheService.getPreference(videoId);
                console.log(`📦 本地快取 preference:`, localPref);
                if (localPref?.lrclibId) {
                  lrclibId = localPref.lrclibId;
                  console.log(`📝 從本地快取獲取 LRCLIB ID: ${lrclibId}`);
                }
                if (localPref?.neteaseId) {
                  neteaseId = localPref.neteaseId;
                  console.log(`📝 從本地快取獲取 NetEase ID: ${neteaseId}`);
                }
              }

              // 優先使用 LRCLIB ID
              if (lrclibId) {
                console.log(`📝 使用儲存的 LRCLIB ID: ${lrclibId}`);
                const lrcLibLyrics = await apiService.getLyricsByLRCLIBId(videoId, lrclibId);
                if (lrcLibLyrics) {
                  console.log(`📝 歌詞從 LRCLIB ID 載入: ${pendingTrack.title}`);
                  dispatch(setCurrentLyrics(lrcLibLyrics));
                  lyricsCacheService.set(videoId, lrcLibLyrics).catch(err => {
                    console.warn('Failed to cache lyrics:', err);
                  });
                  dispatch(setLyricsLoading(false));
                  return;
                }
              }

              // 其次使用 NetEase ID
              if (neteaseId) {
                console.log(`📝 使用儲存的 NetEase ID: ${neteaseId}`);
                const neteaseLyrics = await apiService.getLyricsByNeteaseId(videoId, neteaseId);
                if (neteaseLyrics) {
                  console.log(`📝 歌詞從 NetEase ID 載入: ${pendingTrack.title}`);
                  dispatch(setCurrentLyrics(neteaseLyrics));
                  lyricsCacheService.set(videoId, neteaseLyrics).catch(err => {
                    console.warn('Failed to cache lyrics:', err);
                  });
                  dispatch(setLyricsLoading(false));
                  return;
                }
              }

              // 2. 如果沒有使用者偏好，檢查本地快取
              const cachedLyrics = await lyricsCacheService.get(videoId);
              if (cachedLyrics) {
                console.log(`📝 歌詞從本地快取載入: ${pendingTrack.title} (來源: ${cachedLyrics.source})`);
                dispatch(setCurrentLyrics(cachedLyrics));
                dispatch(setLyricsLoading(false));
                return;
              }

              // 3. 從後端自動搜尋
              const lyrics = await apiService.getLyrics(videoId, pendingTrack.title, pendingTrack.channel);
              if (lyrics) {
                console.log(`📝 歌詞從後端載入: ${pendingTrack.title} (來源: ${lyrics.source})`);
                dispatch(setCurrentLyrics(lyrics));
                // 儲存到本地快取
                lyricsCacheService.set(videoId, lyrics).catch(err => {
                  console.warn('Failed to cache lyrics:', err);
                });
              } else {
                console.log(`⚠️ 找不到歌詞: ${pendingTrack.title}`);
                dispatch(setLyricsError('找不到歌詞'));
              }
            } catch (error) {
              console.error('獲取歌詞失敗:', error);
              dispatch(setLyricsError('獲取歌詞失敗'));
            } finally {
              dispatch(setLyricsLoading(false));
            }
          })();
          
          return; // 直接返回，不等後端
        }

        // 沒有前端 cache：直接從 server 串流（邊播邊快取）
        console.log(`🎵 串流播放: ${pendingTrack.title}`);
        const streamUrl = apiService.getStreamUrl(videoId);
        audioRef.current!.src = streamUrl;
        audioRef.current!.load();
        setIsCached(false);

        // 背景：等 server 快取完成 → 下載到前端 IndexedDB → 無痛切換 Blob URL
        const bgVideoId = videoId;
        const bgStreamUrl = apiService.getStreamUrl(videoId);
        (async () => {
          // 等 backend 快取完成
          for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 3000));
            if (currentVideoIdRef.current !== bgVideoId) return;
            const s = await apiService.getCacheStatus(bgVideoId).catch(() => ({ cached: false }));
            if (s.cached) break;
          }
          if (currentVideoIdRef.current !== bgVideoId) return;

          // 下載到前端 IndexedDB
          try {
            await audioCacheService.fetchAndCache(bgVideoId, bgStreamUrl, {
              title: pendingTrack.title, channel: pendingTrack.channel,
              thumbnail: pendingTrack.thumbnail, duration: pendingTrack.duration,
            });
          } catch { return; }

          if (currentVideoIdRef.current !== bgVideoId) return;
          const blob = await audioCacheService.get(bgVideoId);
          if (!blob || currentVideoIdRef.current !== bgVideoId) return;

          const audio = audioRef.current;
          if (!audio) return;
          const curTime = audio.currentTime;
          const wasPlaying = !audio.paused;
          const blobUrl = URL.createObjectURL(blob);

          const preventEnded = (e: Event) => { e.stopImmediatePropagation(); };
          audio.addEventListener('ended', preventEnded, { capture: true });
          audio.addEventListener('error', preventEnded, { capture: true });

          audio.src = blobUrl;
          audio.load();
          await new Promise<void>(r => { audio.addEventListener('canplay', () => r(), { once: true }); setTimeout(r, 5000); });

          audio.removeEventListener('ended', preventEnded, { capture: true });
          audio.removeEventListener('error', preventEnded, { capture: true });

          if (currentVideoIdRef.current !== bgVideoId) { URL.revokeObjectURL(blobUrl); return; }
          if (currentBlobUrlRef.current) URL.revokeObjectURL(currentBlobUrlRef.current);
          currentBlobUrlRef.current = blobUrl;
          try { audio.currentTime = curTime; } catch {}
          if (wasPlaying) audio.play().catch(() => {});
          setCacheToast(true);
        })();

        // 音訊準備好了，現在確認切換
        console.log(`✅ Pending track ready: ${pendingTrack.title}`);

        // 保存舊的 blob URL，稍後釋放
        const oldBlobUrl = currentBlobUrlRef.current;
        const audio = audioRef.current!;

        // 停止舊音訊（避免舊音訊繼續播放）
        audio.pause();
        audio.currentTime = 0;

        // 在影片模式下，不設置音訊源（避免音訊和影片同時播放）
        if (displayModeRef.current === 'video') {
          console.log(`🎬 影片模式：不設置音訊源，等待 VideoPlayer 初始化`);
          currentVideoIdRef.current = videoId;
          currentBlobUrlRef.current = null;
        } else {
          currentVideoIdRef.current = videoId;
          // audio.src 已在上面的流程中設定
          if (audio.src && audio.src.startsWith('blob:')) {
            currentBlobUrlRef.current = audio.src;
          } else {
            currentBlobUrlRef.current = null;
          }
        }
        pendingBlobUrlRef.current = null;

        // 釋放舊的 blob URL（如果有的話）
        if (oldBlobUrl && oldBlobUrl.startsWith('blob:')) {
          setTimeout(() => {
            console.log(`🗑️ Revoking old blob URL`);
            URL.revokeObjectURL(oldBlobUrl);
          }, 1000);
        }

        // 等待音訊準備好再確認切換
        // 使用多重事件監聽和 timeout fallback 確保手機端可以正常播放
        let hasConfirmed = false;
        let fallbackTimeoutId: ReturnType<typeof setTimeout> | null = null;

        const confirmAndPlay = (eventSource: string) => {
          if (hasConfirmed) return;
          hasConfirmed = true;

          // 清除 fallback timeout
          if (fallbackTimeoutId) {
            clearTimeout(fallbackTimeoutId);
            fallbackTimeoutId = null;
          }

          const shouldPlay = isPlayingRef.current;
          console.log(`🎵 Audio ready (${eventSource}): ${pendingTrack.title}, isPlaying: ${shouldPlay}`);
          setIsLoading(false);

          // 確認切換（UI 現在更新）
          dispatch(confirmPendingTrack());

          // Trigger background style analysis for current track
          if (pendingTrack) {
            apiService.analyzeTrackStyle(videoId, pendingTrack.title, pendingTrack.channel).catch(() => {});
          }

          // 自動播放（影片模式下由 VideoPlayer 控制，不播放音訊）
          if (shouldPlay && displayModeRef.current !== 'video') {
            console.log(`▶️ Auto-playing audio: ${pendingTrack.title}`);
            audio.play().catch((error) => {
              console.error('Failed to auto-play:', error);
              if (error.name === 'NotAllowedError') {
                // 瀏覽器阻擋自動播放，顯示點擊播放按鈕
                setAutoplayBlocked(true);
              } else {
                dispatch(setIsPlaying(false));
              }
            });
          } else if (displayModeRef.current === 'video') {
            console.log(`🎬 影片模式下不播放音訊，由 VideoPlayer 控制`);
          }

          // 🎵 播放成功後才開始搜尋歌詞
          dispatch(setLyricsLoading(true));
          (async () => {
            try {
              // 1. 先檢查使用者是否有儲存特定的歌詞選擇
              let lrclibId: number | null = null;
              let neteaseId: number | null = null;
              try {
                console.log(`🔍 查詢後端歌詞偏好: ${videoId}`);
                const backendPrefs = await apiService.getLyricsPreferences(videoId);
                if (backendPrefs?.lrclibId) {
                  lrclibId = backendPrefs.lrclibId;
                }
                if (backendPrefs?.neteaseId) {
                  neteaseId = backendPrefs.neteaseId;
                }
              } catch (error) {
                console.log(`⚠️ 後端獲取失敗，使用本地快取 preference`, error);
                const localPref = await lyricsCacheService.getPreference(videoId);
                if (localPref?.lrclibId) lrclibId = localPref.lrclibId;
                if (localPref?.neteaseId) neteaseId = localPref.neteaseId;
              }

              if (lrclibId) {
                const lrcLibLyrics = await apiService.getLyricsByLRCLIBId(videoId, lrclibId);
                if (lrcLibLyrics) {
                  console.log(`📝 歌詞從 LRCLIB ID 載入: ${pendingTrack.title}`);
                  dispatch(setCurrentLyrics(lrcLibLyrics));
                  lyricsCacheService.set(videoId, lrcLibLyrics).catch(err => console.warn('Failed to cache lyrics:', err));
                  dispatch(setLyricsLoading(false));
                  return;
                }
              }

              if (neteaseId) {
                const neteaseLyrics = await apiService.getLyricsByNeteaseId(videoId, neteaseId);
                if (neteaseLyrics) {
                  console.log(`📝 歌詞從 NetEase ID 載入: ${pendingTrack.title}`);
                  dispatch(setCurrentLyrics(neteaseLyrics));
                  lyricsCacheService.set(videoId, neteaseLyrics).catch(err => console.warn('Failed to cache lyrics:', err));
                  dispatch(setLyricsLoading(false));
                  return;
                }
              }

              // 2. 檢查本地快取（只用 AI 生成的快取，跳過傳統來源）
              const cachedLyrics = await lyricsCacheService.get(videoId);
              if (cachedLyrics && cachedLyrics.source === 'manual') {
                // AI 生成的快取，直接用
                console.log(`📝 歌詞從 AI 快取載入: ${pendingTrack.title}`);
                dispatch(setCurrentLyrics(cachedLyrics));
                dispatch(setLyricsLoading(false));
                return;
              }

              // 3. 傳統來源為主（時間戳準確），AI 只做翻譯
              const lyrics = await apiService.getLyrics(videoId, pendingTrack.title, pendingTrack.channel);
              if (lyrics && lyrics.lines?.length > 3) {
                console.log(`📝 歌詞載入: ${pendingTrack.title} (${lyrics.source}, ${lyrics.lines.length} 行, synced: ${lyrics.isSynced})`);
                dispatch(setCurrentLyrics(lyrics));
                lyricsCacheService.set(videoId, lyrics).catch(() => {});
              } else {
                // 傳統來源找不到好歌詞，顯示提示
                dispatch(setLyricsError('找不到歌詞'));
              }
            } catch (error) {
              console.error('獲取歌詞失敗:', error);
              dispatch(setLyricsError('獲取歌詞失敗'));
            } finally {
              dispatch(setLyricsLoading(false));
            }
          })();
        };

        const handleCanPlay = () => confirmAndPlay('canplay');
        const handleCanPlayThrough = () => confirmAndPlay('canplaythrough');
        const handleLoadedData = () => confirmAndPlay('loadeddata');

        const handleLoadedMetadata = () => {
          dispatch(setDuration(audio.duration));
          // 在手機端，有時只有 loadedmetadata 會觸發，延遲 500ms 後確認
          setTimeout(() => {
            if (!hasConfirmed && audio.readyState >= 1) {
              confirmAndPlay('loadedmetadata-delayed');
            }
          }, 500);
        };

        // 多重事件監聽確保相容性（手機瀏覽器可能只觸發部分事件）
        audio.addEventListener('canplay', handleCanPlay, { once: true });
        audio.addEventListener('canplaythrough', handleCanPlayThrough, { once: true });
        audio.addEventListener('loadeddata', handleLoadedData, { once: true });
        audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });

        // Timeout fallback：10秒後如果還沒觸發任何事件，根據 readyState 決定
        fallbackTimeoutId = setTimeout(() => {
          if (!hasConfirmed) {
            if (audio.readyState >= 2) {
              // readyState >= 2 表示有足夠數據可以播放
              console.warn(`⚠️ Audio events timeout (readyState: ${audio.readyState}), confirming: ${pendingTrack.title}`);
              confirmAndPlay('timeout-fallback');
            } else if (audio.readyState >= 1) {
              // readyState 1 表示有元數據但數據不足，再等 5 秒
              console.warn(`⚠️ Audio not ready (readyState: ${audio.readyState}), waiting 5 more seconds...`);
              setTimeout(() => {
                if (!hasConfirmed) {
                  console.warn(`⚠️ Extended timeout, forcing confirm (readyState: ${audio.readyState})`);
                  confirmAndPlay('extended-timeout');
                }
              }, 5000);
            } else {
              // readyState 0 表示還沒開始加載，再等 15 秒
              // （設定 src 後瀏覽器需要時間開始載入）
              console.warn(`⚠️ Audio not started loading (readyState: 0), waiting 15 more seconds...`);
              setTimeout(() => {
                if (!hasConfirmed) {
                  if (audio.readyState >= 1) {
                    console.warn(`⚠️ Audio started loading after delay, confirming...`);
                    confirmAndPlay('delayed-start-confirm');
                  } else {
                    // readyState 仍是 0：觸發重試而不是放棄
                    console.warn(`⚠️ Audio readyState still 0 after 25s, triggering retry for: ${pendingTrack.title}`);
                    const vid = currentVideoIdRef.current;
                    if (vid) {
                      const freshUrl = `${apiService.getStreamUrl(vid)}?_retry=timeout&_t=${Date.now()}`;
                      audio.src = freshUrl;
                      audio.load();
                      audio.play().catch(() => {});
                    } else {
                      setIsLoading(false);
                      dispatch(cancelPendingTrack());
                      dispatch(setIsPlaying(false));
                    }
                  }
                }
              }, 15000);
            }
          }
        }, 10000);

        console.log(`🔄 Calling audio.load() for: ${pendingTrack.title}`);
        audio.load();
        console.log(`✅ audio.load() completed, readyState: ${audio.readyState}`);

      } catch (error) {
        console.error('Failed to load pending audio:', error);
        setIsLoading(false);
        dispatch(cancelPendingTrack());
        dispatch(setIsPlaying(false));
      }
    };

    loadPendingAudio();

    // 清理函數
    return () => {
      // 如果有未使用的 pending blob URL，釋放它
      if (pendingBlobUrlRef.current) {
        URL.revokeObjectURL(pendingBlobUrlRef.current);
        pendingBlobUrlRef.current = null;
      }
    };
  }, [pendingTrack, dispatch]);

  // 當播放狀態改變時（影片模式下不播放音訊）
  useEffect(() => {
    if (!audioRef.current) return;

    let playWhenReadyHandler: (() => void) | null = null;
    const audio = audioRef.current;

    if (displayMode === 'video') {
      // 🎬 進入影片模式：靜音但保留 audio 元素播放
      // 重要：不能清空 audio.src，否則 iOS 鎖屏時 Media Session 失效
      if (audio.src) {
        lastAudioSrcRef.current = audio.currentSrc || audio.src;
      }
      lastAudioTimeRef.current = audio.currentTime || 0;
      lastAudioMutedRef.current = audio.muted;

      // 靜音音訊，讓影片的聲音為主，但保持播放（Media Session 需要）
      audio.muted = true;
      audio.volume = 0;
      // 確保 audio 持續播放，否則 iOS 鎖屏時 Media Session 失效
      if (audio.paused && audio.src) {
        audio.play().catch(() => {});
      }
      console.log('🔇 影片模式：音訊靜音但持續播放（保留 Media Session 用於鎖屏控制）');
    } else {
      // 🎵 返回音訊模式：恢復音訊狀態
      if (!audio.src && lastAudioSrcRef.current) {
        audio.src = lastAudioSrcRef.current;
        audio.load();
      }

      audio.muted = lastAudioMutedRef.current;
      audio.volume = volume; // 恢復音量 (volume 已是 0-1)

      // 恢復音訊時間（從 Redux 獲取最新時間，已由 VideoPlayer 同步）
      if (currentTime > 0 && audio.readyState >= 1) {
        try {
          audio.currentTime = currentTime;
          console.log(`🔄 從影片模式切回，同步時間: ${currentTime.toFixed(1)}s`);
        } catch {
          // 忽略設置時間失敗
        }
      }

      if (isPlaying && !isLoadingTrack) {
        if (audio.paused && audio.readyState >= 2) {
          console.log('🔄 從影片模式切回，恢復音訊播放');
          audio.play().catch((error) => {
            console.error('Failed to resume playback:', error);
            dispatch(setIsPlaying(false));
          });
        } else if (audio.paused && audio.readyState < 2) {
          playWhenReadyHandler = () => {
            if (displayModeRef.current !== 'video') {
              audio.play().catch((error) => {
                console.error('Failed to resume after ready:', error);
                dispatch(setIsPlaying(false));
              });
            }
          };
          audio.addEventListener('canplay', playWhenReadyHandler, { once: true });
        }
      } else if (!isPlaying && !audio.paused) {
        audio.pause();
      }
    }

    return () => {
      if (playWhenReadyHandler && audioRef.current) {
        audioRef.current.removeEventListener('canplay', playWhenReadyHandler);
      }
    };
  }, [displayMode, isPlaying, isLoadingTrack, dispatch]);

  // 當音量改變時
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // 當需要 seek 時（僅在非影片模式下，且不在載入中）
  useEffect(() => {
    if (seekTarget !== null && audioRef.current && displayMode !== 'video' && !isLoadingTrack) {
      audioRef.current.currentTime = seekTarget;
      dispatch(clearSeekTarget());
    }
  }, [seekTarget, displayMode, isLoadingTrack, dispatch]);

  // 預加載下一首：先 backend 下載，再前端 IndexedDB 快取
  useEffect(() => {
    if (!currentTrack || playlist.length === 0 || currentIndex < 0) return;
    const nextIdx = currentIndex + 1;
    if (nextIdx >= playlist.length) return;

    const nextTrack = playlist[nextIdx];
    let cancelled = false;

    (async () => {
      // 已在前端快取？跳過
      const cached = await audioCacheService.get(nextTrack.videoId);
      if (cached || cancelled) return;

      // 檢查 backend 是否已快取
      const status = await apiService.getCacheStatus(nextTrack.videoId).catch(() => ({ cached: false }));
      if (cancelled) return;

      if (!status.cached) {
        // 觸發 backend 下載（等當前歌播到 50% 再觸發，避免搶資源）
        const waitForProgress = () => new Promise<void>(resolve => {
          const check = setInterval(() => {
            if (cancelled) { clearInterval(check); resolve(); return; }
            const audio = audioRef.current;
            if (audio && audio.duration > 0 && audio.currentTime / audio.duration > 0.5) {
              clearInterval(check);
              resolve();
            }
          }, 3000);
        });
        await waitForProgress();
        if (cancelled) return;

        console.log(`🔄 預載下一首 (backend): ${nextTrack.title}`);
        apiService.preloadAudio(nextTrack.videoId).catch(() => {});

        // 等 backend 快取完成
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 3000));
          if (cancelled) return;
          const s = await apiService.getCacheStatus(nextTrack.videoId).catch(() => ({ cached: false }));
          if (s.cached) break;
        }
      }

      if (cancelled) return;

      // 下載到前端 IndexedDB
      console.log(`⏬ 預載下一首 (前端): ${nextTrack.title}`);
      const streamUrl = apiService.getStreamUrl(nextTrack.videoId);
      audioCacheService.fetchAndCache(nextTrack.videoId, streamUrl, {
        title: nextTrack.title,
        channel: nextTrack.channel,
        thumbnail: nextTrack.thumbnail,
        duration: nextTrack.duration,
      }).then(() => {
        console.log(`✅ 下一首預載完成: ${nextTrack.title}`);
      }).catch(err => {
        console.warn(`⚠️ 下一首預載失敗: ${nextTrack.title}`, err);
      });
    })();

    return () => { cancelled = true; };
  }, [currentTrack?.videoId, currentIndex, playlist]);

  // 音訊事件處理（在有曲目時添加）
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      return;
    }

    let stalledTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastTimeUpdate = Date.now();
    let lastCurrentTime = 0;
    let streamRetryCount = 0;
    const MAX_STREAM_RETRIES = 3;
    const STREAM_RETRY_DELAYS = [1000, 3000, 7000]; // exponential backoff

    const handleTimeUpdate = () => {
      // 影片模式時不更新時間（由 VideoPlayer 負責）
      if (displayMode !== 'video') {
        dispatch(setCurrentTime(audio.currentTime));
      }
      // Record complete when 90% reached
      if (!completeSentRef.current && audio.duration > 0 && audio.currentTime >= audio.duration * 0.9) {
        completeSentRef.current = true;
        wasCompletedRef.current = true;
        if (currentVideoIdRef.current) {
          apiService.recordComplete(currentVideoIdRef.current).catch(() => {});
        }
      }
      // SponsorBlock: 自動跳過片段
      const t = audio.currentTime;
      for (const seg of skipSegmentsRef.current) {
        if (t >= seg.start && t < seg.end && t !== lastSkipRef.current) {
          const skipDuration = Math.round(seg.end - seg.start);
          const labels: Record<string, string> = {
            music_offtopic: '非音樂段落', sponsor: '工商廣告',
            intro: '片頭', outro: '片尾',
            selfpromo: '自我推廣', interaction: '訂閱提醒',
          };
          console.log(`🚫 [SponsorBlock] Skipping ${seg.category}: ${seg.start.toFixed(1)}→${seg.end.toFixed(1)}`);
          audio.currentTime = seg.end;
          lastSkipRef.current = seg.end;
          setSkipToast(`已跳過${labels[seg.category] || seg.category} ${skipDuration}s`);
          break;
        }
      }
      // 追蹤時間更新，用於偵測假播放
      lastTimeUpdate = Date.now();
      lastCurrentTime = audio.currentTime;
    };

    const handleDurationChange = () => {
      // 影片模式時不更新時長（由 VideoPlayer 負責）
      if (displayMode !== 'video') {
        dispatch(setDuration(audio.duration));
      }
    };

    const handleEnded = () => {
      wasCompletedRef.current = true;
      // Record complete signal (only if not already sent at 90%)
      if (!completeSentRef.current && currentVideoIdRef.current) {
        completeSentRef.current = true;
        apiService.recordComplete(currentVideoIdRef.current).catch(() => {});
      }
      // 影片模式時由 VideoPlayer 處理播放結束
      if (displayMode !== 'video') {
        dispatch(playNext());
      }
    };

    const handleError = async (e: Event) => {
      const error = (e.target as HTMLAudioElement).error;
      console.error('Audio error:', error?.code, error?.message);

      const videoId = currentVideoIdRef.current;
      if (!videoId || isCached) {
        dispatch(setIsPlaying(false));
        return;
      }

      streamRetryCount++;
      if (streamRetryCount > MAX_STREAM_RETRIES) {
        console.error(`❌ All ${MAX_STREAM_RETRIES} retries failed for ${videoId}`);
        dispatch(setIsPlaying(false));
        return;
      }

      const delay = STREAM_RETRY_DELAYS[streamRetryCount - 1] || 7000;
      console.log(`🔄 Retry ${streamRetryCount}/${MAX_STREAM_RETRIES}: waiting ${delay}ms, checking cache first...`);

      await new Promise(r => setTimeout(r, delay));
      if (currentVideoIdRef.current !== videoId) return;

      // 先檢查背景下載是否已完成
      const status = await apiService.getCacheStatus(videoId).catch(() => ({ cached: false }));
      if (status.cached) {
        console.log(`✅ 背景下載已完成，從快取播放: ${videoId}`);
        setIsCached(true);
      } else {
        console.log(`⏳ 快取未完成，重試串流: ${videoId}`);
      }

      const freshUrl = `${apiService.getStreamUrl(videoId)}?_retry=${streamRetryCount}&_t=${Date.now()}`;
      audio.src = freshUrl;
      audio.load();
      audio.play().catch(() => {});
    };

    // 手機端特殊處理：偵測假播放（進度在跑但沒聲音）
    const handleStalled = () => {
      console.warn('⚠️ Audio stalled - 音訊載入停滯');
      // 嘗試重新載入
      if (stalledTimeout) clearTimeout(stalledTimeout);
      stalledTimeout = setTimeout(() => {
        if (audio.paused === false && audio.currentTime === lastCurrentTime && displayModeRef.current !== 'video') {
          console.log('🔄 嘗試重新載入音訊...');
          const currentSrc = audio.src;
          const currentPosition = audio.currentTime;
          audio.src = '';
          audio.src = currentSrc;
          audio.currentTime = currentPosition;
          audio.play().catch(console.error);
        }
      }, 3000);
    };

    const handleWaiting = () => {
      console.log('⏳ Audio waiting - 等待緩衝...');
      // 设置超时自动恢复播放，防止卡住
      setTimeout(() => {
        if (audio && !audio.paused && audio.readyState >= 2 && isPlaying) {
          console.log('🔄 Waiting 超时，尝试恢复播放...');
          audio.play().catch(err => console.error('恢复播放失败:', err));
        }
      }, 3000); // 3秒后尝试恢复
    };

    const handleSeeked = () => {
      console.log('✅ Seeked 完成');
      // Seek 完成后，如果应该在播放状态，确保继续播放
      if (isPlaying && audio.paused && audio.readyState >= 2) {
        console.log('🔄 Seek 后恢复播放...');
        audio.play().catch(err => console.error('Seek后播放失败:', err));
      }
    };

    // 偵測假播放：播放中但時間沒有更新
    let fakePlaybackRetryCount = 0;
    const MAX_FAKE_PLAYBACK_RETRIES = 3;

    const checkFakePlayback = setInterval(() => {
      if (!audio.paused && isPlaying && displayMode !== 'video') {
        const timeSinceUpdate = Date.now() - lastTimeUpdate;
        // 如果超過 4 秒沒有時間更新，可能是假播放
        if (timeSinceUpdate > 4000 && audio.currentTime === lastCurrentTime && audio.currentTime > 0) {
          fakePlaybackRetryCount++;
          console.warn(`⚠️ 偵測到假播放 (第 ${fakePlaybackRetryCount} 次)，嘗試恢復...`);

          // 多策略恢復
          const recoveryStrategies = [
            // 策略 1: seek 到當前位置觸發重新載入
            () => {
              console.log('🔄 策略 1: Seek 恢復');
              audio.currentTime = audio.currentTime + 0.1;
              return audio.play();
            },
            // 策略 2: 暫停後重新播放
            () => {
              console.log('🔄 策略 2: 暫停重播');
              audio.pause();
              return new Promise<void>((resolve) => {
                setTimeout(() => {
                  audio.play().then(resolve).catch(() => resolve());
                }, 200);
              });
            },
            // 策略 3: 重新載入音訊源
            () => {
              console.log('🔄 策略 3: 重新載入');
              const src = audio.src;
              const pos = audio.currentTime;
              audio.src = '';
              audio.src = src;
              audio.currentTime = pos;
              return audio.play();
            },
          ];

          const strategyIndex = Math.min(fakePlaybackRetryCount - 1, recoveryStrategies.length - 1);
          recoveryStrategies[strategyIndex]().catch((err) => {
            console.error('恢復失敗:', err);
            if (fakePlaybackRetryCount >= MAX_FAKE_PLAYBACK_RETRIES) {
              console.error('❌ 已達最大重試次數，停止播放');
              dispatch(setIsPlaying(false));
              fakePlaybackRetryCount = 0;
            }
          });
        } else if (timeSinceUpdate < 2000) {
          // 正常播放中，重置重試計數
          fakePlaybackRetryCount = 0;
        }
      }
    }, 3000); // 改為 3 秒檢查一次

    // 影片模式防護：確保音訊在影片模式下保持靜音（但不暫停，保留 Media Session）
    const handlePlaying = () => {
      if (displayModeRef.current === 'video') {
        if (!audio.muted) {
          audio.muted = true;
          audio.volume = 0;
          console.log('🔇 影片模式下確保音訊靜音');
        }
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('stalled', handleStalled);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('seeked', handleSeeked);

    // iOS 鎖屏恢復：頁面回到前台時自動恢復播放
    const handleVisibilityChange = () => {
      if (!document.hidden && isPlayingRef.current && audio.paused && audio.src) {
        console.log('📱 頁面回到前台，恢復音訊播放');
        audio.play().catch((err) => {
          console.warn('恢復播放失敗:', err);
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (stalledTimeout) clearTimeout(stalledTimeout);
      clearInterval(checkFakePlayback);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('stalled', handleStalled);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('seeked', handleSeeked);
    };
  }, [currentTrack, displayMode, isPlaying, dispatch]);

  // Media Session API - 支援手機鎖屏播放控制與背景播放
  useEffect(() => {
    if (!currentTrack || !('mediaSession' in navigator)) {
      return;
    }

    // 設定媒體元資料（鎖屏顯示）
    const artwork = currentTrack.thumbnail ? [
      { src: currentTrack.thumbnail, sizes: '96x96', type: 'image/jpeg' },
      { src: currentTrack.thumbnail, sizes: '128x128', type: 'image/jpeg' },
      { src: currentTrack.thumbnail, sizes: '192x192', type: 'image/jpeg' },
      { src: currentTrack.thumbnail, sizes: '256x256', type: 'image/jpeg' },
      { src: currentTrack.thumbnail, sizes: '384x384', type: 'image/jpeg' },
      { src: currentTrack.thumbnail, sizes: '512x512', type: 'image/jpeg' },
    ] : [];

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.channel,
      artwork,
    });

    // 設定播放控制按鈕回調
    navigator.mediaSession.setActionHandler('play', () => {
      dispatch(setIsPlaying(true));
      if (displayModeRef.current !== 'video') {
        audioRef.current?.play();
      }
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      dispatch(setIsPlaying(false));
      audioRef.current?.pause();
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      dispatch(playPrevious());
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      dispatch(playNext());
    });

    // 明確移除 seekbackward/seekforward，iOS 才會顯示上/下首按鈕而非前進後退 10 秒
    try {
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
    } catch {
      // 部分瀏覽器不支援設為 null
    }

    console.log('🎵 Media Session API 已設定:', currentTrack.title);

    return () => {
      // 清理 action handlers
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
      } catch {
        // 忽略清理錯誤
      }
    };
  }, [currentTrack, dispatch]);

  // 沒有 currentTrack 也沒有 pendingTrack 時，仍需渲染隱藏的 audio 元素
  // 以便 pendingTrack 可以使用它來載入音訊
  if (!currentTrack && !pendingTrack) {
    return <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />;
  }

  // 有 pendingTrack 但沒有 currentTrack 時，顯示載入狀態
  const displayTrack = currentTrack || pendingTrack;

  if (!displayTrack) {
    return <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />;
  }

  return (
    <Card
      sx={{
        ...(!embedded && {
          position: 'fixed',
          bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))', // BottomNav 高度 + safe area
          left: 0,
          right: 0,
          zIndex: 1000,
        }),
        borderRadius: 0,
        height: embedded ? '100%' : 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {embedded ? (
        /* ===== EMBEDDED 模式（全螢幕歌詞內）===== */
        <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', pb: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'flex-start', pt: 2, alignItems: 'center' }}>
            <CardMedia
              component="img"
              sx={{ width: '100%', height: 'auto', aspectRatio: '1', maxWidth: 280, borderRadius: 1 }}
              image={displayTrack.thumbnail}
              alt={displayTrack.title}
            />
            <Box sx={{ width: '100%', mt: 1 }}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600, width: '100%', textAlign: 'center' }}>
                {displayTrack.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ textAlign: 'center', mb: 1 }}>
                {displayTrack.channel}
              </Typography>
              <PlayerControls embedded />
              <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 2 }}>
                {autoplayBlocked && (
                  <Button variant="contained" color="primary" size="small" startIcon={<PlayArrowIcon />}
                    onClick={() => { audioRef.current?.play().then(() => setAutoplayBlocked(false)).catch(console.error); }}
                  >點擊播放</Button>
                )}
                {!autoplayBlocked && onOpenLyrics && (
                  <IconButton onClick={onOpenLyrics}><LyricsIcon /></IconButton>
                )}
                {!autoplayBlocked && (
                  <IconButton onClick={(e) => setPlaylistMenuAnchor(e.currentTarget)}><PlaylistAddIcon /></IconButton>
                )}
              </Box>
            </Box>
          </Box>
        </CardContent>
      ) : (
        /* ===== 迷你播放器模式（固定在底部）===== */
        <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
          {/* 第一行：封面 + 標題/頻道 + 功能按鈕 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <CardMedia
              component="img"
              sx={{ width: 48, height: 48, borderRadius: 0.5, flexShrink: 0 }}
              image={displayTrack.thumbnail}
              alt={displayTrack.title}
            />
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                {displayTrack.title}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
                  {displayTrack.channel}
                </Typography>
                {!isLoading && !isLoadingTrack && (
                  <Chip
                    icon={isCached ? <StorageIcon sx={{ fontSize: 12 }} /> : <CloudIcon sx={{ fontSize: 12 }} />}
                    label={isCached ? '快取' : '網路'}
                    size="small"
                    sx={{ height: 18, fontSize: '0.65rem', backgroundColor: isCached ? 'success.main' : 'primary.main', color: 'white', '& .MuiChip-icon': { color: 'white' } }}
                  />
                )}
                {(isLoading || isLoadingTrack) && <CircularProgress size={14} />}
              </Box>
            </Box>
            {/* 功能按鈕 */}
            {autoplayBlocked ? (
              <IconButton size="small" color="primary"
                onClick={() => { audioRef.current?.play().then(() => setAutoplayBlocked(false)).catch(console.error); }}
              ><PlayArrowIcon /></IconButton>
            ) : (
              <>
                {onOpenLyrics && <IconButton size="small" onClick={onOpenLyrics}><LyricsIcon fontSize="small" /></IconButton>}
                <IconButton size="small" onClick={(e) => setPlaylistMenuAnchor(e.currentTarget)}><PlaylistAddIcon fontSize="small" /></IconButton>
              </>
            )}
          </Box>
          {/* 第二行：進度條 + 控制按鈕 */}
          <PlayerControls isCompact />
        </CardContent>
      )}

      {/* 隱藏的 audio 元素 - 放在 CardContent 外面確保不受條件渲染影響 */}

      {/* 隱藏的 audio 元素 */}
      <audio ref={audioRef} preload="auto" />

      {/* 加入播放清單選單 */}
      {currentTrack && (
        <AddToPlaylistMenu
          anchorEl={playlistMenuAnchor}
          open={Boolean(playlistMenuAnchor)}
          track={currentTrack}
          onClose={() => setPlaylistMenuAnchor(null)}
        />
      )}
      <Snackbar
        open={cacheToast}
        autoHideDuration={2000}
        onClose={() => setCacheToast(false)}
        message="✅ 已切換到快取播放"
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      />
      <Snackbar
        open={!!skipToast}
        autoHideDuration={2000}
        onClose={() => setSkipToast('')}
        message={`🚫 ${skipToast}`}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      />
    </Card>
  );
}
