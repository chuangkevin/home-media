import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Card, CardContent, Typography, CardMedia, CircularProgress } from '@mui/material';
import PlayerControls from './PlayerControls';
import { RootState } from '../../store';
import { setIsPlaying, setCurrentTime, setDuration, clearSeekTarget, playNext } from '../../store/playerSlice';
import apiService from '../../services/api.service';
import audioCacheService from '../../services/audio-cache.service';

export default function AudioPlayer() {
  const dispatch = useDispatch();
  const audioRef = useRef<HTMLAudioElement>(null);
  const { currentTrack, isPlaying, volume, displayMode, seekTarget, playlist, currentIndex } = useSelector((state: RootState) => state.player);
  const [isLoading, setIsLoading] = useState(false);
  const currentVideoIdRef = useRef<string | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);
  const isPlayingRef = useRef(isPlaying);

  // 保持 isPlayingRef 同步
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // 當曲目改變時，使用快取優先策略載入音訊
  useEffect(() => {
    if (!currentTrack || !audioRef.current) return;

    const audio = audioRef.current;
    const videoId = currentTrack.videoId;

    console.log(`🔄 Track changed: ${currentTrack.title} (${videoId}), isPlaying: ${isPlaying}`);

    // 如果已經在播放相同的曲目，不重新載入
    if (currentVideoIdRef.current === videoId) {
      console.log(`⏭️ Same track, skipping reload: ${currentTrack.title}`);
      return;
    }

    const loadAudio = async () => {
      setIsLoading(true);
      console.log(`📥 Starting to load: ${currentTrack.title}`);

      // 保存舊的 blob URL，稍後釋放
      const oldBlobUrl = currentBlobUrlRef.current;

      try {

        // 優先使用快取
        const cached = await audioCacheService.get(videoId);

        let blobUrl: string;

        if (cached) {
          // 使用快取的音訊
          blobUrl = URL.createObjectURL(cached);
          console.log(`🎵 Playing from cache: ${currentTrack.title}`);
        } else {
          // 從後端下載並快取
          console.log(`⏬ Downloading: ${currentTrack.title}`);
          const streamUrl = apiService.getStreamUrl(videoId);
          blobUrl = await audioCacheService.fetchAndCache(videoId, streamUrl);
        }

        // 設置音訊源
        audio.src = blobUrl;
        currentVideoIdRef.current = videoId;
        currentBlobUrlRef.current = blobUrl;

        console.log(`✅ Loaded new track: ${currentTrack.title} (${videoId})`);

        // 等待音訊準備好
        const handleCanPlay = () => {
          const shouldPlay = isPlayingRef.current;
          console.log(`🎵 Audio ready to play: ${currentTrack.title}, isPlaying: ${shouldPlay}`);
          setIsLoading(false);

          // 現在可以安全地釋放舊的 blob URL
          if (oldBlobUrl && oldBlobUrl !== blobUrl) {
            setTimeout(() => {
              console.log(`🗑️ Revoking old blob URL after new track loaded`);
              URL.revokeObjectURL(oldBlobUrl);
            }, 1000); // 延遲 1 秒確保舊的音訊不再被使用
          }

          // 自動播放新曲目
          if (shouldPlay) {
            console.log(`▶️ Auto-playing: ${currentTrack.title}`);
            audio.play().catch((error) => {
              console.error('Failed to auto-play:', error);
              dispatch(setIsPlaying(false));
            });
          } else {
            console.log(`⏸️ Not auto-playing (isPlaying: false)`);
          }
        };

        const handleLoadedMetadata = () => {
          dispatch(setDuration(audio.duration));
        };

        audio.addEventListener('canplay', handleCanPlay, { once: true });
        audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });

        audio.load();
      } catch (error) {
        console.error('Failed to load audio:', error);
        setIsLoading(false);
        dispatch(setIsPlaying(false));
      }
    };

    loadAudio();

    // 清理函數
    return () => {
      // 注意：不要在這裡釋放 blob URL，因為音訊可能還在播放
    };
  }, [currentTrack, dispatch]);

  // 當播放狀態改變時（影片模式下不播放音訊）
  useEffect(() => {
    if (audioRef.current && displayMode !== 'video') {
      const audio = audioRef.current;
      if (isPlaying) {
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
      } else {
        audio.pause();
      }
    } else if (audioRef.current && displayMode === 'video') {
      // 在影片模式下暫停音訊播放器
      audioRef.current.pause();
    }
  }, [isPlaying, displayMode, dispatch]);

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

  if (!currentTrack) {
    return null;
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
            image={currentTrack.thumbnail}
            alt={currentTrack.title}
          />

          {/* 曲目資訊與控制 */}
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600, flexGrow: 1 }}>
                {currentTrack.title}
              </Typography>
              {isLoading && <CircularProgress size={16} />}
            </Box>
            <Typography variant="body2" color="text.secondary" noWrap>
              {currentTrack.channel}
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
