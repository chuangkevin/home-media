import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Typography, Button, Link, CircularProgress } from '@mui/material';
import MusicVideoIcon from '@mui/icons-material/MusicVideo';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { Track } from '../../types/track.types';
import { setDuration, clearSeekTarget, setDisplayMode } from '../../store/playerSlice';
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

// 檢測是否為 iOS 設備
const isIOS = () => {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

export default function VideoPlayer({ track }: VideoPlayerProps) {
  const dispatch = useDispatch();
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recoveryLockRef = useRef(false); // 恢復鎖，防止剛回到前景時過度同步
  const { isPlaying, seekTarget, currentTime } = useSelector((state: RootState) => state.player);

  // 監聽回到前景事件
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        console.log('🎬 應用回到前景，暫停同步 2 秒以建立緩衝');
        recoveryLockRef.current = true;
        setTimeout(() => {
          recoveryLockRef.current = false;
        }, 2000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const isSeekingRef = useRef(false);
  // 從 audio element 讀取實際播放位置（比 Redux currentTime 更準確）
  const getAudioTime = () => {
    const audio = document.querySelector('audio') as HTMLAudioElement | null;
    return audio?.currentTime || currentTime;
  };
  // initialTimeRef removed — onReady 直接用 getAudioTime()
  // 錯誤狀態
  const [error, setError] = useState<string | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 當曲目變化時重置狀態
  useEffect(() => {
    setError(null);
    setLoading(true);
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

      // 重置狀態
      setError(null);
      setShowIOSHint(false);
      setLoading(true);
      
      // 清除舊的超時計時器
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }

      if (window.YT && window.YT.Player) {
        // 設置 10 秒超時：如果 YouTube 沒有響應，認為加載失敗
        loadTimeoutRef.current = setTimeout(() => {
          if (isMounted && !playerRef.current?.getPlayerState) {
            console.warn('🎬 YouTube 播放器加載超時');
            const timeoutError = '影片載入超時';
            setError(timeoutError);
            
            if (isIOS()) {
              setShowIOSHint(true);
              setTimeout(() => {
                console.log('🎬 iOS 加載超時，自動切換到視覺化器模式');
                dispatch(setDisplayMode('visualizer'));
              }, 3000);
            }
          }
        }, 10000);

        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId: track.videoId,
          playerVars: {
            autoplay: 1, // 移動設備需要 autoplay: 1 才能正常加載
            enablejsapi: 1,
            playsinline: 1, // 行動裝置內嵌播放（不全螢幕）
            origin: window.location.origin,
            rel: 0,
            modestbranding: 1,
            controls: 1,
            fs: 1,
            iv_load_policy: 3,
            // iOS 兼容性參數
            widget_referrer: window.location.origin,
          },
          events: {
            onReady: (event: any) => {
              if (!isMounted) return;

              // 清除超時計時器 - 播放器已就緒
              if (loadTimeoutRef.current) {
                clearTimeout(loadTimeoutRef.current);
                loadTimeoutRef.current = null;
              }

              setLoading(false);
              console.log(`🎬 YouTube 播放器就緒: ${track.videoId}`);

              // 靜音 iframe — audio element 是唯一音源（支援背景播放 + 鎖屏）
              event.target.mute();

              // 用 YouTube metadata duration（比 iframe getDuration 更一致）
              const effectiveDuration = track.duration > 0 ? track.duration : event.target.getDuration();
              dispatch(setDuration(effectiveDuration));

              // 同步到當前音訊播放位置（直接讀 audio element，最準確）
              const syncTime = getAudioTime();
              if (syncTime > 0) {
                try {
                  event.target.seekTo(syncTime, true);
                  console.log(`🎬 影片同步到音訊位置: ${syncTime.toFixed(1)}s`);
                } catch (e) {
                  console.warn('🎬 尋找位置失敗:', e);
                }
              }

              // iOS: YouTube's built-in play button handles user gesture requirement
              // No need for custom overlay - just let the iframe handle it
              if (isIOS()) {
                console.log('🎬 iOS: YouTube 內建播放按鈕處理自動播放限制');
                // Try to play anyway - if blocked, YouTube shows its own play button
                try {
                  event.target.playVideo();
                } catch {}
                return;
              }

              // 根據當前播放狀態決定是否播放
              // 注意：此時 isPlaying 會在下一個 effect 同步，所以檢查 Redux 狀態
              if (event.target && event.target.playVideo) {
                // 延遲檢查，讓 AudioPlayer 的 effect 先執行完畢
                const checkPlayState = setTimeout(() => {
                  if (isMounted && playerRef.current) {
                    const playerState = playerRef.current.getPlayerState();
                    // 只有在播放狀態為 unstarted (-1) 或 paused (2) 時才播放
                    // 這樣避免重複播放
                    if (isPlaying && playerState !== 1) {
                      console.log('🎬 影片自動開始播放');
                      event.target.playVideo();
                    } else if (!isPlaying) {
                      console.log('🎬 影片保持暫停狀態');
                    }
                  }
                }, 100);

                return () => clearTimeout(checkPlayState);
              }
            },
            onStateChange: (event: any) => {
              if (!isMounted) return;
              const audioEl = document.querySelector('audio') as HTMLAudioElement | null;
              const audioTime = audioEl?.currentTime || 0;

              if (event.data === 1) {
                // iframe 開始播放 — 立即同步到 audio 位置
                const videoTime = event.target.getCurrentTime();
                if (Math.abs(videoTime - audioTime) > 1) {
                  event.target.seekTo(audioTime, true);
                }
              } else if (event.data === 2 || event.data === -1) {
                if (audioEl && !audioEl.paused) {
                  event.target.seekTo(audioTime, true);
                  event.target.playVideo();
                }
              }
            },
            onError: (event: any) => {
              if (!isMounted) return;

              // 清除超時計時器 - 已收到錯誤回調
              if (loadTimeoutRef.current) {
                clearTimeout(loadTimeoutRef.current);
                loadTimeoutRef.current = null;
              }

              setLoading(false);
              const errorCode = event.data;
              const errorMessage = YT_ERROR_CODES[errorCode] || `YouTube 錯誤碼: ${errorCode}`;
              console.error(`🎬 YouTube 播放器錯誤: ${errorCode} - ${errorMessage}`);
              setError(errorMessage);
              
              // iOS 上的嵌入播放限制（錯誤碼 101 或 150）
              if (isIOS() && (errorCode === 101 || errorCode === 150)) {
                setShowIOSHint(true);
                // 3秒後自動切換到視覺化器模式（音頻播放）
                setTimeout(() => {
                  console.log('🎬 iOS 嵌入播放受限，自動切換到視覺化器模式');
                  dispatch(setDisplayMode('visualizer'));
                }, 3000);
              }
            },
          },
        });

        // 清除舊的 interval（如果有）
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }

        // 定期同步 iframe 位置到 audio element（audio 是唯一音源）
        intervalRef.current = setInterval(() => {
          if (
            playerRef.current && 
            playerRef.current.getCurrentTime && 
            playerRef.current.seekTo && 
            isMounted && 
            !isSeekingRef.current &&
            !recoveryLockRef.current // 鎖屏恢復期間不執行同步
          ) {
            const videoTime = playerRef.current.getCurrentTime();
            const audioTime = getAudioTime();
            const drift = Math.abs(videoTime - audioTime);
            // 偏差超過 2 秒就修正（MV 播放下 2 秒是可接受的容差，能減少不必要的 seek）
            if (drift > 2) {
              playerRef.current.seekTo(audioTime, true);
              console.log(`🎬 影片同步修正: video=${videoTime.toFixed(1)}→audio=${audioTime.toFixed(1)}s (drift=${drift.toFixed(1)}s)`);
            }
          }
        }, 1000); // 降低同步頻率至 1 秒一次，減少系統負荷
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
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
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
              // 靜音 iframe — audio element 是唯一音源
              event.target.mute();
              const effectiveDuration = track.duration > 0 ? track.duration : event.target.getDuration();
              dispatch(setDuration(effectiveDuration));
              // 同步到當前音訊位置
              const syncTime = getAudioTime();
              if (syncTime > 0) {
                event.target.seekTo(syncTime, true);
                console.log(`🎬 影片（fallback path）同步到: ${syncTime.toFixed(1)}s`);
              }
              event.target.playVideo();
            },
            onStateChange: (event: any) => {
              const audioEl = document.querySelector('audio') as HTMLAudioElement | null;
              const audioTime = audioEl?.currentTime || 0;
              if (event.data === 1) {
                const videoTime = event.target.getCurrentTime();
                if (Math.abs(videoTime - audioTime) > 1) {
                  event.target.seekTo(audioTime, true);
                }
              } else if (event.data === 2 || event.data === -1) {
                if (audioEl && !audioEl.paused) {
                  event.target.seekTo(audioTime, true);
                  event.target.playVideo();
                }
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
        {showIOSHint && (
          <Typography variant="body2" color="warning.main" sx={{ fontWeight: 'bold', textAlign: 'center', mb: 1 }}>
            📱 iOS 設備不支援此影片的嵌入播放<br />
            將在 3 秒後自動切換到音頻播放模式...
          </Typography>
        )}
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
        position: 'relative',
        backgroundColor: 'black',
      }}
    >
      {loading && (
        <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'white', zIndex: 1 }}>
          <CircularProgress color="inherit" />
        </Box>
      )}
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
