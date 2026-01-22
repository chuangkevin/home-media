import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box } from '@mui/material';
import type { Track } from '../../types/track.types';
import { setIsPlaying, setCurrentTime, setDuration, clearSeekTarget, playNext } from '../../store/playerSlice';
import { RootState } from '../../store';

interface VideoPlayerProps {
  track: Track;
}

// 擴展 Window 介面以支援 YouTube API
declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export default function VideoPlayer({ track }: VideoPlayerProps) {
  const dispatch = useDispatch();
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isPlaying, seekTarget } = useSelector((state: RootState) => state.player);
  const isSeekingRef = useRef(false);

  // 載入 YouTube IFrame API
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // 初始化 YouTube 播放器
  useEffect(() => {
    const initPlayer = () => {
      if (window.YT && window.YT.Player && containerRef.current) {
        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId: track.videoId,
          playerVars: {
            autoplay: 1,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event: any) => {
              event.target.playVideo();
              dispatch(setDuration(event.target.getDuration()));
            },
            onStateChange: (event: any) => {
              // 0 = ended, 1 = playing, 2 = paused
              if (event.data === 0) {
                // 播放結束，自動播放下一首
                dispatch(playNext());
              } else if (event.data === 1) {
                dispatch(setIsPlaying(true));
              } else if (event.data === 2) {
                dispatch(setIsPlaying(false));
              }
            },
          },
        });

        // 定期更新播放時間
        const interval = setInterval(() => {
          if (playerRef.current && playerRef.current.getCurrentTime) {
            const time = playerRef.current.getCurrentTime();
            if (!isSeekingRef.current) {
              dispatch(setCurrentTime(time));
            }
          }
        }, 1000);

        return () => {
          clearInterval(interval);
          if (playerRef.current && playerRef.current.destroy) {
            playerRef.current.destroy();
          }
        };
      }
    };

    if (window.YT && window.YT.Player) {
      return initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }
  }, [track.videoId, dispatch]);

  // 控制播放/暫停
  useEffect(() => {
    if (playerRef.current && playerRef.current.getPlayerState) {
      const playerState = playerRef.current.getPlayerState();
      if (isPlaying && playerState !== 1) {
        playerRef.current.playVideo();
      } else if (!isPlaying && playerState === 1) {
        playerRef.current.pauseVideo();
      }
    }
  }, [isPlaying]);

  // 處理 seek 操作
  useEffect(() => {
    if (seekTarget !== null && playerRef.current && playerRef.current.seekTo) {
      isSeekingRef.current = true;
      playerRef.current.seekTo(seekTarget, true);
      dispatch(clearSeekTarget());
      setTimeout(() => {
        isSeekingRef.current = false;
      }, 500);
    }
  }, [seekTarget, dispatch]);

  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: 800,
        mx: 'auto',
        aspectRatio: '16/9',
        borderRadius: 2,
        overflow: 'hidden',
        boxShadow: 3,
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
        }}
      />
    </Box>
  );
}
