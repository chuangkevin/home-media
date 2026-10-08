import { createYouTubeVideoFollower } from '../../services/youtube-video-follower';
import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Typography, Button, Link, CircularProgress } from '@mui/material';
import MusicVideoIcon from '@mui/icons-material/MusicVideo';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { Track } from '../../types/track.types';
import { setDuration, setDisplayMode, setIsPlaying } from '../../store/playerSlice';
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
  const followerRef = useRef<ReturnType<typeof createYouTubeVideoFollower> | null>(null);
  const generationRef = useRef(0);
  const [retryVersion, setRetryVersion] = useState(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
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

  const latestRef = useRef({ isPlaying, currentTime, videoId: track.videoId });
  latestRef.current = { isPlaying, currentTime, videoId: track.videoId };
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

  // One generation-owned initializer also handles Retry; old SDK callbacks and
  // delayed timers cannot operate on a closed player or a replacement track.
  useEffect(() => {
    let mounted = true;
    const generation = ++generationRef.current;
    let ownedPlayer: any = null;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const isCurrent = () => mounted && generationRef.current === generation
      && latestRef.current.videoId === track.videoId;
    const ownedTimeout = (fn: () => void, delay: number) => {
      const timer = setTimeout(() => { timers.delete(timer); if (isCurrent()) fn(); }, delay);
      timers.add(timer);
      return timer;
    };
    const follower = createYouTubeVideoFollower({
      isCurrent, getPlayer: () => playerRef.current,
      getPlaying: () => latestRef.current.isPlaying,
      onBlockedChange: setAutoplayBlocked,
    });
    followerRef.current = follower;
    let initAttempts = 0;
    const initPlayer = () => {
      if (!isCurrent() || ownedPlayer) return;
      // A track change from the error view mounts the container on the next
      // React commit. Wait only for that owned commit, never reuse an old node.
      if (!containerRef.current) {
        if (++initAttempts <= 5) ownedTimeout(initPlayer, 0);
        return;
      }
      if (!window.YT?.Player) return;
      setError(null);
      setShowIOSHint(false);
      setAutoplayBlocked(false);
      setLoading(true);
      loadTimeoutRef.current = ownedTimeout(() => {
        follower.dispose();
        ownedPlayer?.destroy?.();
        if (playerRef.current === ownedPlayer) playerRef.current = null;
        setLoading(false);
        setError('影片載入超時');
        if (isIOS()) {
          setShowIOSHint(true);
          ownedTimeout(() => dispatch(setDisplayMode('visualizer')), 3000);
        }
      }, 10000);
      ownedPlayer = new window.YT.Player(containerRef.current, {
        videoId: track.videoId,
        playerVars: {
          autoplay: 0, mute: 1, enablejsapi: 1, playsinline: 1,
          origin: window.location.origin, rel: 0, modestbranding: 1,
          controls: 1, fs: 1, iv_load_policy: 3, widget_referrer: window.location.origin,
        },
        events: {
          onReady: (event: any) => {
            if (!follower.onReady(event)) return;
            if (loadTimeoutRef.current) {
              clearTimeout(loadTimeoutRef.current);
              timers.delete(loadTimeoutRef.current);
              loadTimeoutRef.current = null;
            }
            setLoading(false);
            dispatch(setDuration(track.duration > 0 ? track.duration : event.target.getDuration()));
          },
          onStateChange: follower.onStateChange,
          onAutoplayBlocked: follower.onAutoplayBlocked,
          onError: (event: any) => {
            if (!isCurrent() || event.target !== ownedPlayer) return;
            follower.dispose();
            if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
            setLoading(false);
            setError(YT_ERROR_CODES[event.data] || `YouTube 錯誤碼: ${event.data}`);
            if (isIOS() && (event.data === 101 || event.data === 150)) {
              setShowIOSHint(true);
              ownedTimeout(() => dispatch(setDisplayMode('visualizer')), 3000);
            }
          },
        },
      });
      playerRef.current = ownedPlayer;
      intervalRef.current = setInterval(() => {
        if (isCurrent() && !recoveryLockRef.current) follower.tick();
      }, 800);
    };
    if (window.YT?.Player) initPlayer();
    else window.onYouTubeIframeAPIReady = initPlayer;
    return () => {
      mounted = false;
      follower.dispose();
      timers.forEach(clearTimeout);
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      if (followerRef.current === follower) followerRef.current = null;
      if (playerRef.current === ownedPlayer) { playerRef.current = null; loadTimeoutRef.current = null; }
      ownedPlayer?.destroy?.();
      if (window.onYouTubeIframeAPIReady === initPlayer) window.onYouTubeIframeAPIReady = () => {};
    };
  }, [track.videoId, retryVersion, dispatch]);

  useEffect(() => { followerRef.current?.tick(); }, [isPlaying, seekTarget]);

  // 切換回音訊模式（使用視覺化器）
  const handleSwitchToAudio = () => {
    dispatch(setDisplayMode('visualizer'));
  };

  // Manual play changes the authoritative audio intent, never only the iframe.
  const handleTapToPlay = () => {
    dispatch(setIsPlaying(true));
    followerRef.current?.retryOnGesture();
  };

  const handleRetry = () => {
    setError(null);
    setLoading(true);
    setRetryVersion(version => version + 1);
  };

  // 如果有錯誤，顯示錯誤訊息和切換選項
  if (error) {
    return (
      <Box
        sx={{
          width: '100%',
          maxWidth: 800,
          mx: 'auto',
          minHeight: { xs: 360, sm: 420 },
          borderRadius: 2,
          overflow: 'auto',
          boxShadow: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'grey.900',
          color: 'white',
          gap: 2,
          p: { xs: 2.5, sm: 4 },
        }}
      >
        {error === '行動裝置需要手動點擊播放' ? (
          <PlayCircleOutlineIcon sx={{ fontSize: 64, opacity: 0.85 }} />
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
            行動瀏覽器限制自動播放，請按「點擊播放」開始。
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
      {autoplayBlocked && (
        <Box sx={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 2, textAlign: 'center', bgcolor: 'rgba(0,0,0,0.8)', p: 1, color: 'white' }}>
          <Typography role="status" variant="body2">瀏覽器暫停了影片自動播放，音樂仍由音訊播放器控制。</Typography>
          <Button color="inherit" onClick={handleTapToPlay} aria-label="重試影片播放" sx={{ minHeight: 44 }}>點擊播放影片</Button>
        </Box>
      )}
      {loading && (
        <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: 'white', zIndex: 1 }}>
          <CircularProgress color="inherit" aria-label="影片載入中" />
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
