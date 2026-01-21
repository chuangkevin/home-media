import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Card, CardContent, Typography, CardMedia } from '@mui/material';
import PlayerControls from './PlayerControls';
import { RootState } from '../../store';
import { setIsPlaying, setCurrentTime, setDuration, clearSeekTarget } from '../../store/playerSlice';
import apiService from '../../services/api.service';

export default function AudioPlayer() {
  const dispatch = useDispatch();
  const audioRef = useRef<HTMLAudioElement>(null);
  const { currentTrack, isPlaying, volume, displayMode, seekTarget } = useSelector((state: RootState) => state.player);

  // 當曲目改變時，載入新的音訊
  useEffect(() => {
    if (currentTrack && audioRef.current) {
      const streamUrl = apiService.getStreamUrl(currentTrack.videoId);
      const audio = audioRef.current;

      // 避免重複載入相同的 URL
      if (audio.src === streamUrl) {
        return;
      }

      audio.src = streamUrl;
      audio.load();

      const handleLoadedMetadata = () => {
        dispatch(setDuration(audio.duration));
      };

      audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });

      return () => {
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      };
    }
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
      dispatch(setIsPlaying(false));
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
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
              {currentTrack.title}
            </Typography>
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
