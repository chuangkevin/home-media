import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Card, CardContent, Typography, CardMedia, CircularProgress, Button } from '@mui/material';
import LyricsIcon from '@mui/icons-material/Lyrics';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PlayerControls from './PlayerControls';
import { RootState } from '../../store';
import { setIsPlaying, setCurrentTime, setDuration, clearSeekTarget, playNext, confirmPendingTrack, cancelPendingTrack } from '../../store/playerSlice';
import { setCurrentLyrics, setIsLoading as setLyricsLoading, setError as setLyricsError } from '../../store/lyricsSlice';
import apiService from '../../services/api.service';
import audioCacheService from '../../services/audio-cache.service';
import lyricsCacheService from '../../services/lyrics-cache.service';

interface AudioPlayerProps {
  showLyricsButton?: boolean;
  onScrollToLyrics?: () => void;
}

export default function AudioPlayer({ showLyricsButton, onScrollToLyrics }: AudioPlayerProps) {
  const dispatch = useDispatch();
  const audioRef = useRef<HTMLAudioElement>(null);
  const { currentTrack, pendingTrack, isLoadingTrack, isPlaying, volume, displayMode, seekTarget, playlist, currentIndex } = useSelector((state: RootState) => state.player);
  const [isLoading, setIsLoading] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const currentVideoIdRef = useRef<string | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const pendingBlobUrlRef = useRef<string | null>(null);
  const isPlayingRef = useRef(isPlaying);

  // 保持 isPlayingRef 同步
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

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
        // 優先檢查快取
        const cached = await audioCacheService.get(videoId);
        const streamUrl = apiService.getStreamUrl(videoId);

        let audioSrc: string;
        let isCached = false;

        if (cached) {
          // 使用快取的 blob URL
          audioSrc = URL.createObjectURL(cached);
          isCached = true;
          console.log(`🎵 從快取播放: ${pendingTrack.title}`);
        } else {
          // 直接使用串流 URL 播放（不等待下載完成）
          audioSrc = streamUrl;
          console.log(`🌐 從網路串流: ${pendingTrack.title}`);

          // 背景下載到快取（不阻塞播放）
          audioCacheService.fetchAndCache(videoId, streamUrl)
            .then(() => console.log(`💾 背景快取完成: ${pendingTrack.title}`))
            .catch(err => console.warn(`背景快取失敗: ${pendingTrack.title}`, err));
        }

        // 儲存 pending blob URL (只有 cached 才是 blob URL)
        pendingBlobUrlRef.current = isCached ? audioSrc : null;

        // 音訊準備好了，現在確認切換
        console.log(`✅ Pending track ready: ${pendingTrack.title} (來源: ${isCached ? '快取' : '網路'})`);

        // 保存舊的 blob URL，稍後釋放
        const oldBlobUrl = currentBlobUrlRef.current;
        const audio = audioRef.current!;

        // 設置新音訊源
        audio.src = audioSrc;
        currentVideoIdRef.current = videoId;
        currentBlobUrlRef.current = isCached ? audioSrc : null;
        pendingBlobUrlRef.current = null;

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

          // 釋放舊的 blob URL（只有 blob: 開頭的才需要釋放）
          if (oldBlobUrl && oldBlobUrl.startsWith('blob:') && oldBlobUrl !== audioSrc) {
            setTimeout(() => {
              console.log(`🗑️ Revoking old blob URL`);
              URL.revokeObjectURL(oldBlobUrl);
            }, 1000);
          }

          // 自動播放
          if (shouldPlay) {
            console.log(`▶️ Auto-playing: ${pendingTrack.title}`);
            audio.play().catch((error) => {
              console.error('Failed to auto-play:', error);
              if (error.name === 'NotAllowedError') {
                // 瀏覽器阻擋自動播放，顯示點擊播放按鈕
                setAutoplayBlocked(true);
              } else {
                dispatch(setIsPlaying(false));
              }
            });
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

        // Timeout fallback：5秒後如果還沒觸發任何事件，強制確認
        fallbackTimeoutId = setTimeout(() => {
          if (!hasConfirmed) {
            console.warn(`⚠️ Audio events timeout, forcing confirm: ${pendingTrack.title}`);
            confirmAndPlay('timeout-fallback');
          }
        }, 5000);

        audio.load();

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
    if (audioRef.current && displayMode !== 'video') {
      const audio = audioRef.current;
      if (isPlaying && !isLoadingTrack) {
        // 如果音訊已經準備好，直接播放
        if (audio.readyState >= 2) {
          audio.play().catch((error) => {
            console.error('Failed to play:', error);
            if (error.name === 'NotAllowedError') {
              setAutoplayBlocked(true);
            } else {
              dispatch(setIsPlaying(false));
            }
          });
        } else {
          // 如果音訊還沒準備好，等待 canplay 事件
          const playWhenReady = () => {
            audio.play().catch((error) => {
              console.error('Failed to play:', error);
              if (error.name === 'NotAllowedError') {
                setAutoplayBlocked(true);
              } else {
                dispatch(setIsPlaying(false));
              }
            });
          };
          audio.addEventListener('canplay', playWhenReady, { once: true });
        }
      } else if (!isPlaying) {
        audio.pause();
      }
    } else if (audioRef.current && displayMode === 'video') {
      // 在影片模式下暫停音訊播放器
      audioRef.current.pause();
    }
  }, [isPlaying, isLoadingTrack, displayMode, dispatch]);

  // 當音量改變時
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // 當需要 seek 時（僅在非影片模式下）
  useEffect(() => {
    if (seekTarget !== null && audioRef.current && displayMode !== 'video') {
      audioRef.current.currentTime = seekTarget;
      dispatch(clearSeekTarget());
    }
  }, [seekTarget, displayMode, dispatch]);

  // 預加載後面三首歌曲到前端快取
  useEffect(() => {
    if (currentTrack && playlist.length > 0 && currentIndex >= 0) {
      const preloadIndices = [currentIndex + 1, currentIndex + 2, currentIndex + 3];

      console.log(`🔄 預載後面 3 首歌曲...`);

      preloadIndices.forEach(async (idx) => {
        if (idx < playlist.length) {
          const track = playlist[idx];
          const streamUrl = apiService.getStreamUrl(track.videoId);

          // 背景預載（不阻塞主流程）
          audioCacheService.preload(track.videoId, streamUrl)
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

    const handleTimeUpdate = () => {
      // 影片模式時不更新時間（由 VideoPlayer 負責）
      if (displayMode !== 'video') {
        dispatch(setCurrentTime(audio.currentTime));
      }
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

    const handleError = () => {
      dispatch(setIsPlaying(false));
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [currentTrack, displayMode, dispatch]);

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

          {/* 看歌詞按鈕 - 當歌詞區域不可見時顯示 */}
          {showLyricsButton && onScrollToLyrics && !autoplayBlocked && (
            <Button
              variant="contained"
              size="small"
              startIcon={<LyricsIcon />}
              onClick={onScrollToLyrics}
              sx={{
                ml: 2,
                whiteSpace: 'nowrap',
                minWidth: 'auto',
              }}
            >
              看歌詞
            </Button>
          )}
        </Box>
      </CardContent>

      {/* 隱藏的 audio 元素 */}
      <audio ref={audioRef} preload="auto" />
    </Card>
  );
}
