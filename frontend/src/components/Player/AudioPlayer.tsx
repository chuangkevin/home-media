import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Card, CardContent, Typography, CardMedia, CircularProgress, Button, Chip, IconButton, Tooltip } from '@mui/material';
import LyricsIcon from '@mui/icons-material/Lyrics';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CloudIcon from '@mui/icons-material/Cloud';
import StorageIcon from '@mui/icons-material/Storage';
import PlayerControls from './PlayerControls';
import { RootState } from '../../store';
import { setIsPlaying, setCurrentTime, setDuration, clearSeekTarget, playNext, playPrevious, confirmPendingTrack, cancelPendingTrack } from '../../store/playerSlice';
import { setCurrentLyrics, setIsLoading as setLyricsLoading, setError as setLyricsError } from '../../store/lyricsSlice';
import apiService from '../../services/api.service';
import audioCacheService from '../../services/audio-cache.service';
import lyricsCacheService from '../../services/lyrics-cache.service';

interface AudioPlayerProps {
  onOpenLyrics?: () => void;
}

export default function AudioPlayer({ onOpenLyrics }: AudioPlayerProps) {
  const dispatch = useDispatch();
  const audioRef = useRef<HTMLAudioElement>(null);
  const { currentTrack, pendingTrack, isLoadingTrack, isPlaying, volume, displayMode, seekTarget, playlist, currentIndex, currentTime } = useSelector((state: RootState) => state.player);
  const [isLoading, setIsLoading] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const currentVideoIdRef = useRef<string | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const pendingBlobUrlRef = useRef<string | null>(null);
  const lastAudioSrcRef = useRef<string | null>(null);
  const lastAudioTimeRef = useRef<number>(0);
  const lastAudioMutedRef = useRef<boolean>(false);
  const isPlayingRef = useRef(isPlaying);
  const displayModeRef = useRef(displayMode);

  // 快取狀態
  const [isCached, setIsCached] = useState(false);

  // 保持 isPlayingRef 同步
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // 保持 displayModeRef 同步
  useEffect(() => {
    displayModeRef.current = displayMode;
  }, [displayMode]);

  // 當有 pendingTrack 時，預載音訊（不切換 UI）
  useEffect(() => {
    if (!pendingTrack || !audioRef.current) return;

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
          
          return; // 直接返回，不等後端
        }

        // 沒有前端 cache，並行檢查後端 + 觸發預加載
        console.log(`🔄 檢查後端快取: ${pendingTrack.title}`);
        
        const [serverStatus] = await Promise.all([
          apiService.getCacheStatus(videoId).catch(() => ({ cached: false })),
          apiService.preloadAudio(videoId).catch(() => {}), // 不等待，並行觸發
        ]);

        const streamUrl = apiService.getStreamUrl(videoId);
        let audioSrc: string;

        
        if (serverStatus.cached) {
          // 後端有 cache，使用後端串流
          audioSrc = streamUrl;
          console.log(`🎵 從後端快取串流: ${pendingTrack.title}`);
          setIsCached(true);
        } else {
          // 後端沒 cache：立即串流播放，背景下載快取（不阻塞）
          console.log(`🎵 立即串流播放，背景下載快取: ${pendingTrack.title}`);
          audioSrc = streamUrl;
          setIsCached(false);
          
          // 背景下載到前端快取（不阻塞播放）
          audioCacheService.fetchAndCache(videoId, streamUrl, {
            title: pendingTrack.title,
            channel: pendingTrack.channel,
            thumbnail: pendingTrack.thumbnail,
            duration: pendingTrack.duration,
          })
            .then(() => {
              console.log(`💾 背景快取下載完成: ${pendingTrack.title}`);
              setIsCached(true);
            })
            .catch(err => console.warn(`背景快取下載失敗: ${pendingTrack.title}`, err));
        }

        // 設定 audio src
        audioRef.current!.src = audioSrc;
        audioRef.current!.load();

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
          // 設置新音訊源（如果是 Blob URL，需要更新 ref）
          console.log(`🎵 Setting audio.src = ${audioSrc.substring(0, 50)}...`);
          audio.src = audioSrc;
          currentVideoIdRef.current = videoId;
          
          // 如果是 Blob URL，儲存 ref 以便後續釋放
          if (audioSrc.startsWith('blob:')) {
            currentBlobUrlRef.current = audioSrc;
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
                    console.error(`❌ Audio failed to start loading (readyState: ${audio.readyState}): ${pendingTrack.title}`);
                    setIsLoading(false);
                    dispatch(cancelPendingTrack());
                    dispatch(setIsPlaying(false));
                  }
                }
              }, 15000);
            }
          }
        }, 10000);

        console.log(`🔄 Calling audio.load() for: ${pendingTrack.title}`);
        audio.load();
        console.log(`✅ audio.load() completed, readyState: ${audio.readyState}`);

        // 並行獲取歌詞（先查本地快取，再檢查使用者偏好，最後查後端）
        dispatch(setLyricsLoading(true));
        (async () => {
          try {
            // 先檢查本地快取
            const cachedLyrics = await lyricsCacheService.get(videoId);
            if (cachedLyrics) {
              console.log(`📝 歌詞從本地快取載入: ${pendingTrack.title} (來源: ${cachedLyrics.source})`);
              dispatch(setCurrentLyrics(cachedLyrics));
              dispatch(setLyricsLoading(false));
              return;
            }

            // 檢查使用者是否有儲存特定的歌詞選擇（優先從後端 API 獲取，跨裝置同步）
            let lrclibId: number | null = null;
            try {
              const backendPrefs = await apiService.getLyricsPreferences(videoId);
              if (backendPrefs?.lrclibId) {
                lrclibId = backendPrefs.lrclibId;
                console.log(`📝 從後端獲取 LRCLIB ID: ${lrclibId}`);
              }
            } catch {
              // 後端獲取失敗，fallback 到本地
              const localPref = await lyricsCacheService.getPreference(videoId);
              if (localPref?.lrclibId) {
                lrclibId = localPref.lrclibId;
                console.log(`📝 從本地快取獲取 LRCLIB ID: ${lrclibId}`);
              }
            }

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

            // 從後端自動搜尋
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
      // 🎬 進入影片模式：完全停止音訊
      if (audio.src) {
        lastAudioSrcRef.current = audio.currentSrc || audio.src;
      }
      lastAudioTimeRef.current = audio.currentTime || 0;
      lastAudioMutedRef.current = audio.muted;

      if (!audio.paused) {
        audio.pause();
        console.log('⏸️ 暫停音訊，切換到影片模式');
      }

      audio.muted = true;

      // 完全清空音訊源，確保不會播放
      if (audio.src) {
        audio.src = '';
        audio.load();
        console.log('🎬 已清空音訊源，確保影片模式下不播放音訊');
      }
    } else {
      // 🎵 返回音訊模式：恢復音訊狀態
      if (!audio.src && lastAudioSrcRef.current) {
        audio.src = lastAudioSrcRef.current;
        audio.load();
      }

      audio.muted = lastAudioMutedRef.current;

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

  // 預加載下一首歌曲到前端快取（減少並發壓力）
  useEffect(() => {
    if (currentTrack && playlist.length > 0 && currentIndex >= 0) {
      const preloadIndices = [currentIndex + 1];

      console.log(`🔄 預載下 1 首歌曲...`);

      preloadIndices.forEach(async (idx) => {
        if (idx < playlist.length) {
          const track = playlist[idx];
          const streamUrl = apiService.getStreamUrl(track.videoId);

          // 背景預載（不阻塞主流程）
          audioCacheService.preload(track.videoId, streamUrl, {
            title: track.title,
            channel: track.channel,
            thumbnail: track.thumbnail,
            duration: track.duration,
          })
            .then(() => {
              console.log(`✅ 預載完成 (#${idx + 1}): ${track.title}`);
            })
            .catch(err => {
              console.warn(`⚠️ 預載失敗 (#${idx + 1}): ${track.title}`, err);
            });
        }
      });
    }
  }, [currentTrack, playlist, currentIndex]);

  // 音訊事件處理（在有曲目時添加）
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      return;
    }

    let stalledTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastTimeUpdate = Date.now();
    let lastCurrentTime = 0;

    const handleTimeUpdate = () => {
      // 影片模式時不更新時間（由 VideoPlayer 負責）
      if (displayMode !== 'video') {
        dispatch(setCurrentTime(audio.currentTime));
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
      // 影片模式時由 VideoPlayer 處理播放結束
      if (displayMode !== 'video') {
        dispatch(playNext());
      }
    };

    const handleError = (e: Event) => {
      const error = (e.target as HTMLAudioElement).error;
      console.error('Audio error:', error?.code, error?.message);
      dispatch(setIsPlaying(false));
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

    // 影片模式防護：無論什麼原因觸發了 audio.play()，在影片模式下一律暫停
    const handlePlaying = () => {
      if (displayModeRef.current === 'video') {
        console.log('🎬 影片模式下攔截音訊播放，自動暫停');
        audio.pause();
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('stalled', handleStalled);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('playing', handlePlaying);

    return () => {
      if (stalledTimeout) clearTimeout(stalledTimeout);
      clearInterval(checkFakePlayback);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('stalled', handleStalled);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('playing', handlePlaying);
    };
  }, [currentTrack, displayMode, isPlaying, dispatch]);

  // Media Session API - 支援手機鎖屏播放控制與背景播放
  useEffect(() => {
    if (!currentTrack || !('mediaSession' in navigator)) {
      return;
    }

    // 設定媒體元資料（鎖屏顯示）
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.channel,
      artwork: [
        { src: currentTrack.thumbnail, sizes: '96x96', type: 'image/jpeg' },
        { src: currentTrack.thumbnail, sizes: '128x128', type: 'image/jpeg' },
        { src: currentTrack.thumbnail, sizes: '192x192', type: 'image/jpeg' },
        { src: currentTrack.thumbnail, sizes: '256x256', type: 'image/jpeg' },
        { src: currentTrack.thumbnail, sizes: '384x384', type: 'image/jpeg' },
        { src: currentTrack.thumbnail, sizes: '512x512', type: 'image/jpeg' },
      ],
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

    // 支援快進快退（如果瀏覽器支援）
    try {
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const skipTime = details.seekOffset || 10;
        if (audioRef.current) {
          audioRef.current.currentTime = Math.max(audioRef.current.currentTime - skipTime, 0);
        }
      });

      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const skipTime = details.seekOffset || 10;
        if (audioRef.current) {
          audioRef.current.currentTime = Math.min(
            audioRef.current.currentTime + skipTime,
            audioRef.current.duration || 0
          );
        }
      });
    } catch {
      // 某些瀏覽器不支援 seekbackward/seekforward
    }

    console.log('🎵 Media Session API 已設定:', currentTrack.title);

    return () => {
      // 清理 action handlers
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
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
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1100,
        borderRadius: 0,
      }}
    >
      <CardContent sx={{ pb: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* 專輯封面 */}
          <CardMedia
            component="img"
            sx={{ width: 80, height: 80, borderRadius: 1 }}
            image={displayTrack.thumbnail}
            alt={displayTrack.title}
          />

          {/* 曲目資訊與控制 */}
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600, flexGrow: 1 }}>
                {displayTrack.title}
              </Typography>
              {/* 快取狀態標籤 */}
              {!isLoading && !isLoadingTrack && (
                <Chip
                  icon={isCached ? <StorageIcon sx={{ fontSize: 14 }} /> : <CloudIcon sx={{ fontSize: 14 }} />}
                  label={isCached ? '快取' : '網路'}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: '0.7rem',
                    backgroundColor: isCached ? 'success.main' : 'primary.main',
                    color: 'white',
                    '& .MuiChip-icon': { color: 'white' },
                  }}
                />
              )}
              {(isLoading || isLoadingTrack) && <CircularProgress size={16} />}
            </Box>
            <Typography variant="body2" color="text.secondary" noWrap>
              {displayTrack.channel}
            </Typography>

            <PlayerControls />
          </Box>

          {/* 點擊播放按鈕 - 當自動播放被阻擋時顯示 */}
          {autoplayBlocked && (
            <Button
              variant="contained"
              color="primary"
              size="large"
              startIcon={<PlayArrowIcon />}
              onClick={() => {
                if (audioRef.current) {
                  audioRef.current.play().then(() => {
                    setAutoplayBlocked(false);
                  }).catch(console.error);
                }
              }}
              sx={{
                ml: 2,
                whiteSpace: 'nowrap',
                animation: 'pulse 1.5s infinite',
                '@keyframes pulse': {
                  '0%': { boxShadow: '0 0 0 0 rgba(25, 118, 210, 0.7)' },
                  '70%': { boxShadow: '0 0 0 10px rgba(25, 118, 210, 0)' },
                  '100%': { boxShadow: '0 0 0 0 rgba(25, 118, 210, 0)' },
                },
              }}
            >
              點擊播放
            </Button>
          )}

          {/* 歌詞按鈕 */}
          {!autoplayBlocked && onOpenLyrics && (
            <Tooltip title="開啟歌詞">
              <IconButton
                onClick={onOpenLyrics}
                sx={{ ml: 1 }}
              >
                <LyricsIcon />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </CardContent>

      {/* 隱藏的 audio 元素 */}
      <audio ref={audioRef} preload="auto" />
    </Card>
  );
}
