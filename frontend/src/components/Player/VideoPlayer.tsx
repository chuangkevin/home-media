import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Typography, Button, Link } from '@mui/material';
import MusicVideoIcon from '@mui/icons-material/MusicVideo';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { Track } from '../../types/track.types';
import { setIsPlaying, setCurrentTime, setDuration, clearSeekTarget, playNext, setDisplayMode } from '../../store/playerSlice';
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

// YouTube IFrame Player error codes
const YT_ERROR_CODES: Record<number, string> = {
  2: '無效的影片 ID',
  5: 'HTML5 播放器錯誤',
  100: '找不到影片（已刪除或設為私人）',
  101: '此影片不允許嵌入播放',
  150: '此影片不允許嵌入播放', // Same as 101
};

export default function VideoPlayer({ track }: VideoPlayerProps) {
  const dispatch = useDispatch();
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { isPlaying, seekTarget, currentTime } = useSelector((state: RootState) => state.player);
  const isSeekingRef = useRef(false);
  // 記住切換到影片模式時的音訊播放位置
  const initialTimeRef = useRef<number>(currentTime);
  // 錯誤狀態
  const [error, setError] = useState<string | null>(null);

  // 當曲目變化時重置錯誤
  useEffect(() => {
    setError(null);
  }, [track.videoId]);

  // 載入 YouTube IFrame API
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // 初始化 YouTube 播放器
  useEffect(() => {
    let isMounted = true;

    const initPlayer = () => {
      if (!isMounted || !containerRef.current) return;

      // 重置錯誤狀態
      setError(null);

      if (window.YT && window.YT.Player) {
        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId: track.videoId,
          playerVars: {
            autoplay: 0, // 改為 0，由 onReady 手動控制播放
            enablejsapi: 1,
            playsinline: 1, // 行動裝置內嵌播放（不全螢幕）
            origin: window.location.origin,
            rel: 0,
            modestbranding: 1,
            controls: 1,
            fs: 1,
            iv_load_policy: 3,
          },
          events: {
            onReady: (event: any) => {
              if (!isMounted) return;
              console.log(`🎬 YouTube 播放器就緒: ${track.videoId}`);
              dispatch(setDuration(event.target.getDuration()));
              
              // 同步到切換前的音訊播放位置
              if (initialTimeRef.current > 0) {
                try {
                  event.target.seekTo(initialTimeRef.current, true);
                  console.log(`🎬 影片同步到 ${initialTimeRef.current.toFixed(1)}s`);
                } catch (e) {
                  console.warn('🎬 尋找位置失敗:', e);
                }
              }
              
              // 嘗試播放
              try {
                const playPromise = event.target.playVideo();
                if (playPromise && typeof playPromise.catch === 'function') {
                  playPromise.catch((err: any) => {
                    console.warn('🎬 播放被阻擋或失敗:', err);
                    setError('播放被瀏覽器阻擋，請點擊手動播放');
                  });
                }
              } catch (e) {
                console.warn('🎬 調用 playVideo() 失敗:', e);
                setError('播放器初始化失敗');
              }
            },
            onStateChange: (event: any) => {
              if (!isMounted) return;
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
            onError: (event: any) => {
              if (!isMounted) return;
              const errorCode = event.data;
              const errorMessage = YT_ERROR_CODES[errorCode] || `YouTube 錯誤碼: ${errorCode}`;
              console.error(`🎬 YouTube 播放器錯誤: ${errorCode} - ${errorMessage}`);
              setError(errorMessage);
            },
          },
        });

        // 清除舊的 interval（如果有）
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }

        // 定期更新播放時間
        intervalRef.current = setInterval(() => {
          if (playerRef.current && playerRef.current.getCurrentTime && isMounted) {
            const time = playerRef.current.getCurrentTime();
            if (!isSeekingRef.current) {
              dispatch(setCurrentTime(time));
            }
          }
        }, 500); // 更頻繁更新以保持同步
      }
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    // 清理函數
    return () => {
      isMounted = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (playerRef.current && playerRef.current.destroy) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
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

  // 切換回音訊模式（使用視覺化器）
  const handleSwitchToAudio = () => {
    dispatch(setDisplayMode('visualizer'));
  };

  // 手動點擊播放（行動裝置 autoplay 被阻擋時使用）
  const handleTapToPlay = () => {
    setError(null);
    if (playerRef.current?.playVideo) {
      playerRef.current.playVideo();
    }
  };

  // 重試
  const handleRetry = () => {
    setError(null);
    // 強制重新載入播放器
    if (playerRef.current && playerRef.current.destroy) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
    // 清空容器並重新創建
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }
    // 觸發重新初始化（通過改變 key 或重新 mount）
    setTimeout(() => {
      if (window.YT && window.YT.Player && containerRef.current) {
        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId: track.videoId,
          playerVars: {
            autoplay: 1,
            enablejsapi: 1,
            playsinline: 1,
            origin: window.location.origin,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onReady: (event: any) => {
              dispatch(setDuration(event.target.getDuration()));
              event.target.playVideo();
            },
            onStateChange: (event: any) => {
              if (event.data === 0) {
                dispatch(playNext());
              } else if (event.data === 1) {
                dispatch(setIsPlaying(true));
              } else if (event.data === 2) {
                dispatch(setIsPlaying(false));
              }
            },
            onError: (event: any) => {
              const errorCode = event.data;
              const errorMessage = YT_ERROR_CODES[errorCode] || `YouTube 錯誤碼: ${errorCode}`;
              console.error(`🎬 YouTube 播放器錯誤: ${errorCode} - ${errorMessage}`);
              setError(errorMessage);
            },
          },
        });
      }
    }, 100);
  };

  // 如果有錯誤，顯示錯誤訊息和切換選項
  if (error) {
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
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'grey.900',
          color: 'white',
          gap: 2,
          p: 3,
        }}
      >
        {error === '行動裝置需要手動點擊播放' ? (
          <PlayCircleOutlineIcon sx={{ fontSize: 80, opacity: 0.7, cursor: 'pointer' }} onClick={handleTapToPlay} />
        ) : (
          <MusicVideoIcon sx={{ fontSize: 64, opacity: 0.5 }} />
        )}
        <Typography variant="h6" textAlign="center">
          {error}
        </Typography>
        {error === '行動裝置需要手動點擊播放' ? (
          <Typography variant="body2" color="grey.400" textAlign="center">
            行動瀏覽器限制自動播放，請點擊上方圖示開始播放
          </Typography>
        ) : (
          <Typography variant="body2" color="grey.400" textAlign="center">
            此影片無法在嵌入式播放器中播放
            <br />
            可能原因：影片版權限制、地區限制或網路問題
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
          {error === '行動裝置需要手動點擊播放' ? (
            <Button
              variant="contained"
              size="large"
              startIcon={<PlayCircleOutlineIcon />}
              onClick={handleTapToPlay}
            >
              點擊播放
            </Button>
          ) : (
            <Button
              variant="outlined"
              onClick={handleRetry}
              color="inherit"
            >
              重試
            </Button>
          )}
          <Button
            variant="contained"
            onClick={handleSwitchToAudio}
          >
            使用純音訊模式
          </Button>
          <Button
            variant="outlined"
            color="inherit"
            component={Link}
            href={`https://www.youtube.com/watch?v=${track.videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            startIcon={<OpenInNewIcon />}
          >
            在 YouTube 開啟
          </Button>
        </Box>
      </Box>
    );
  }

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
