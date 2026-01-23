import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Card, CardContent, Typography, CardMedia, CircularProgress } from '@mui/material';
import PlayerControls from './PlayerControls';
import { RootState } from '../../store';
import { setIsPlaying, setCurrentTime, setDuration, clearSeekTarget, playNext, confirmPendingTrack, cancelPendingTrack } from '../../store/playerSlice';
import { setCurrentLyrics, setIsLoading as setLyricsLoading, setError as setLyricsError } from '../../store/lyricsSlice';
import apiService from '../../services/api.service';
import audioCacheService from '../../services/audio-cache.service';
import lyricsCacheService from '../../services/lyrics-cache.service';

export default function AudioPlayer() {
  const dispatch = useDispatch();
  const audioRef = useRef<HTMLAudioElement>(null);
  const { currentTrack, pendingTrack, isLoadingTrack, isPlaying, volume, displayMode, seekTarget, playlist, currentIndex } = useSelector((state: RootState) => state.player);
  const [isLoading, setIsLoading] = useState(false);
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

        let blobUrl: string;

        if (cached) {
          blobUrl = URL.createObjectURL(cached);
          console.log(`🎵 Pending track cached: ${pendingTrack.title}`);
        } else {
          // 從後端下載並快取
          console.log(`⏬ Downloading pending: ${pendingTrack.title}`);
          const streamUrl = apiService.getStreamUrl(videoId);
          blobUrl = await audioCacheService.fetchAndCache(videoId, streamUrl);
        }

        // 儲存 pending blob URL
        pendingBlobUrlRef.current = blobUrl;

        // 音訊準備好了，現在確認切換
        console.log(`✅ Pending track ready: ${pendingTrack.title}`);

        // 保存舊的 blob URL，稍後釋放
        const oldBlobUrl = currentBlobUrlRef.current;
        const audio = audioRef.current!;

        // 設置新音訊源
        audio.src = blobUrl;
        currentVideoIdRef.current = videoId;
        currentBlobUrlRef.current = blobUrl;
        pendingBlobUrlRef.current = null;

        // 等待音訊準備好再確認切換
        const handleCanPlay = () => {
          const shouldPlay = isPlayingRef.current;
          console.log(`🎵 Audio ready: ${pendingTrack.title}, isPlaying: ${shouldPlay}`);
          setIsLoading(false);

          // 確認切換（UI 現在更新）
          dispatch(confirmPendingTrack());

          // 釋放舊的 blob URL
          if (oldBlobUrl && oldBlobUrl !== blobUrl) {
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
              dispatch(setIsPlaying(false));
            });
          }
        };

        const handleLoadedMetadata = () => {
          dispatch(setDuration(audio.duration));
        };

        audio.addEventListener('canplay', handleCanPlay, { once: true });
        audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });

        audio.load();

        // 並行獲取歌詞（先查本地快取，再查後端）
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

            // 從後端獲取
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
            dispatch(setIsPlaying(false));
          });
        } else {
          // 如果音訊還沒準備好，等待 canplay 事件
          const playWhenReady = () => {
            audio.play().catch((error) => {
              console.error('Failed to play:', error);
              dispatch(setIsPlaying(false));
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
      dispatch(setCurrentTime(audio.currentTime));
    };

    const handleDurationChange = () => {
      dispatch(setDuration(audio.duration));
    };

    const handleEnded = () => {
      dispatch(playNext());
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
              {(isLoading || isLoadingTrack) && <CircularProgress size={16} />}
            </Box>
            <Typography variant="body2" color="text.secondary" noWrap>
              {displayTrack.channel}
            </Typography>

            <PlayerControls />
          </Box>
        </Box>
      </CardContent>

      {/* 隱藏的 audio 元素 */}
      <audio ref={audioRef} preload="auto" />
    </Card>
  );
}
