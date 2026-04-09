import { useState, useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Alert,
  CircularProgress,
  BottomNavigation,
  BottomNavigationAction,
  Paper,
  useMediaQuery,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import SettingsIcon from '@mui/icons-material/Settings';
import SearchBar from './components/Search/SearchBar';
import SearchResults from './components/Search/SearchResults';
import AudioPlayer from './components/Player/AudioPlayer';
import VideoPlayer from './components/Player/VideoPlayer';
import FullscreenLyrics from './components/Player/FullscreenLyrics';
import HomeRecommendations from './components/Home/HomeRecommendations';
import PlaylistSection from './components/Playlist/PlaylistSection';
import AdminSettings from './components/Admin/AdminSettings';
import RadioButton from './components/Radio/RadioButton';
import RadioIndicator from './components/Radio/RadioIndicator';
import { setPendingTrack, setIsPlaying, addToQueue, setPlaylist, playNow, updateTrackMetadata } from './store/playerSlice';
import { RootState } from './store';
import apiService from './services/api.service';
import audioCacheService from './services/audio-cache.service';
import playbackStateService from './services/playback-state.service';
import type { Track } from './types/track.types';
import { useSocketConnection } from './hooks/useSocketConnection';
import { useRadioSync } from './hooks/useRadioSync';
import { useParams } from 'react-router-dom';

// 單曲頁面元件
// @ts-ignore - 保留以供未來使用
function TrackPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const dispatch = useDispatch();
  const { currentTrack } = useSelector((state: RootState) => state.player);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoId) return;
    
    // 如果當前已經在播放這首歌，不需要重新加載
    if (currentTrack?.videoId === videoId) {
      return;
    }

    // 載入並播放歌曲（刷新頁面或直接訪問 URL 時）
    const loadTrack = async () => {
      try {
        setLoading(true);
        const videoInfo = await apiService.getVideoInfo(videoId);
        const track: Track = {
          id: videoInfo.videoId,
          videoId: videoInfo.videoId,
          title: videoInfo.title,
          channel: videoInfo.channel,
          thumbnail: videoInfo.thumbnail,
          duration: videoInfo.duration,
        };
        
        // 將這首歌設為播放清單，這樣 useAutoQueue 才會觸發
        dispatch(setPlaylist([track]));
        dispatch(setPendingTrack(track));
        dispatch(setIsPlaying(true));
      } catch (err) {
        console.error('Failed to load track:', err);
        setError('載入歌曲失敗');
      } finally {
        setLoading(false);
      }
    };

    loadTrack();
    // 注意：不要將 currentTrack 放入依賴，否則每次歌曲切換都會觸發
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, dispatch]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 3 }}>
        {error}
      </Alert>
    );
  }

  // 顯示推薦內容（與首頁相同）
  return <HomeRecommendations />;
}

// 底部導航列元件
function BottomNav({ scrollToTop }: { scrollToTop: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isUltrawide = useMediaQuery('(min-width: 1200px) and (max-height: 800px)'); // 針對 1920*720 平板

  const getNavValue = () => {
    if (location.pathname === '/playlists') return '/playlists';
    if (location.pathname === '/admin') return '/admin';
    return '/';
  };

  const handleClick = (path: string) => {
    if (getNavValue() === path) {
      scrollToTop();
      return;
    }
    // 保持 playing 參數
    const playing = searchParams.get('playing');
    const newPath = playing ? `${path}?playing=${playing}` : path;
    navigate(newPath);
  };

  return (
    <Paper
      sx={{
        flexShrink: 0,
        paddingBottom: isUltrawide ? 0 : 'env(safe-area-inset-bottom, 0px)',
        borderTop: '1px solid',
        borderColor: 'divider',
        background: (theme) =>
          theme.palette.mode === 'dark'
            ? 'rgba(8, 11, 18, 0.96)'
            : 'rgba(255, 255, 255, 0.96)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
      elevation={0}
    >
      <BottomNavigation
        value={getNavValue()}
        showLabels
        sx={{ minHeight: isUltrawide ? 48 : 60, height: isUltrawide ? 48 : 60, background: 'transparent' }}
      >
        <BottomNavigationAction
          label="首頁"
          value="/"
          icon={<HomeIcon sx={{ fontSize: isUltrawide ? 20 : 24 }} />}
          onClick={() => handleClick('/')}
          sx={{ py: isUltrawide ? 0.5 : 1 }}
        />
        <BottomNavigationAction
          label="播放清單"
          value="/playlists"
          onClick={() => handleClick('/playlists')}
          icon={<QueueMusicIcon sx={{ fontSize: isUltrawide ? 20 : 24 }} />}
          sx={{ py: isUltrawide ? 0.5 : 1 }}
        />
        <BottomNavigationAction
          label="設定"
          value="/admin"
          icon={<SettingsIcon sx={{ fontSize: isUltrawide ? 20 : 24 }} />}
          onClick={() => handleClick('/admin')}
          sx={{ py: isUltrawide ? 0.5 : 1 }}
        />
      </BottomNavigation>
    </Paper>
  );
}

function AppContent() {
  const dispatch = useDispatch();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isUltrawide = useMediaQuery('(min-width: 1200px) and (max-height: 800px)'); // 針對 1920*720 平板
  const { currentTrack, displayMode } = useSelector(
    (state: RootState) => state.player
  );
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [lyricsDrawerOpen, setLyricsDrawerOpen] = useState(false); // 歌詞抽屜狀態
  const [siteTitle, setSiteTitle] = useState('Home Media'); // 網站標題
  // const isShortViewport = useMediaQuery('(max-height: 768px)');

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Socket 連線（遠端控制）
  useSocketConnection();

  // 電台同步（主播/聽眾）
  useRadioSync();

  // 監聽路由變化，自動關閉歌詞抽屜
  useEffect(() => {
    setLyricsDrawerOpen(false);
  }, [location.pathname]);

  // 當歌曲開始播放時，自動展開歌詞抽屜並更新 URL
  useEffect(() => {
    if (currentTrack) {
      setLyricsDrawerOpen(true);
      // 在 URL 中記錄當前播放的歌曲
      const newParams = new URLSearchParams(searchParams);
      newParams.set('playing', currentTrack.videoId);
      setSearchParams(newParams, { replace: true });
    }
  }, [currentTrack?.videoId]);

  // 頁面載入/重整時，從持久化狀態或 URL 恢復播放
  useEffect(() => {
    if (currentTrack) return; // Already playing, skip restore

    const restoreFromPersisted = async (): Promise<boolean> => {
      const persisted = playbackStateService.restore();
      if (!persisted || persisted.playlist.length === 0) return false;

      console.log(`🔄 [PWA Recovery] Restoring session: ${persisted.playlist.length} tracks, index=${persisted.currentIndex}`);

      dispatch(setPlaylist(persisted.playlist as Track[]));

      const idx = persisted.currentIndex >= 0 && persisted.currentIndex < persisted.playlist.length
        ? persisted.currentIndex : 0;
      const track = persisted.playlist[idx];
      dispatch(setPendingTrack(track as Track));
      dispatch(setIsPlaying(true));

      setLyricsDrawerOpen(true);

      if (persisted.currentTime > 5) {
        playbackStateService.setRecoverySeekTarget(persisted.currentTime);
      }
      playbackStateService.clear();
      return true;
    };

    const restoreFromUrl = async (): Promise<void> => {
      const playingVideoId = searchParams.get('playing');
      if (!playingVideoId) return;

      const cached = await audioCacheService.getMetadata(playingVideoId);
      const track: Track = {
        id: playingVideoId,
        videoId: playingVideoId,
        title: cached?.title || '載入中...',
        channel: cached?.channel || '',
        thumbnail: cached?.thumbnail || `https://i.ytimg.com/vi/${playingVideoId}/hqdefault.jpg`,
        duration: cached?.duration || 0,
      };
      dispatch(setPlaylist([track]));
      dispatch(setPendingTrack(track));
      dispatch(setIsPlaying(true));

      if (!cached) {
        apiService.getVideoInfo(playingVideoId).then(videoInfo => {
          dispatch(updateTrackMetadata({
            id: videoInfo.videoId,
            videoId: videoInfo.videoId,
            title: videoInfo.title,
            channel: videoInfo.channel,
            thumbnail: videoInfo.thumbnail,
            duration: videoInfo.duration,
          }));
        }).catch(() => {
          const newParams = new URLSearchParams(searchParams);
          newParams.delete('playing');
          setSearchParams(newParams, { replace: true });
        });
      }
    };

    // Try persisted state first (handles iOS PWA crash recovery), then URL
    restoreFromPersisted().then(restored => {
      if (!restored) restoreFromUrl();
    });
  }, []); // 只在頁面初始化時執行一次

  // 初始化音訊快取服務
  useEffect(() => {
    audioCacheService.init().then(() => {
      // 顯示快取統計
      audioCacheService.getStats().then(stats => {
        console.log(`📊 Audio Cache: ${stats.count}/${stats.maxCount} files, ${stats.totalSizeMB}/${stats.maxSizeMB}MB`);
      });
    }).catch(err => {
      console.error('Failed to initialize audio cache:', err);
    });
  }, []);

  // 載入系統設定（網站標題等）
  useEffect(() => {
    apiService.getSettings().then(settings => {
      if (settings.site_title) {
        setSiteTitle(settings.site_title);
        document.title = settings.site_title;
      }
    }).catch(err => {
      console.error('Failed to load settings:', err);
    });
  }, []);

  // iPhone Safari/PWA 鎖屏回前景後，100dvh/100% 有時不會立刻重算。
  // 改用 visualViewport 驅動 CSS 變數，避免內容頂到靈動島或高度錯亂。
  useEffect(() => {
    const applyViewportHeight = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-dvh', `${viewportHeight}px`);
    };

    const handleVisible = () => {
      requestAnimationFrame(() => {
        applyViewportHeight();
        setTimeout(applyViewportHeight, 120);
      });
    };

    applyViewportHeight();
    window.addEventListener('resize', applyViewportHeight);
    window.visualViewport?.addEventListener('resize', applyViewportHeight);
    window.addEventListener('orientationchange', handleVisible);
    window.addEventListener('pageshow', handleVisible);
    document.addEventListener('visibilitychange', handleVisible);

    return () => {
      window.removeEventListener('resize', applyViewportHeight);
      window.visualViewport?.removeEventListener('resize', applyViewportHeight);
      window.removeEventListener('orientationchange', handleVisible);
      window.removeEventListener('pageshow', handleVisible);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, []);

  const handleSearch = async (query: string) => {
    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const results = await apiService.searchTracks(query, 50);

      // 記錄搜尋歷史（fire-and-forget）
      apiService.recordSearch(query, results.length);

      // 只更新搜尋結果，不替換播放清單（用戶點擊才 playNow）
      setSearchResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜尋失敗，請稍後再試');
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (track: Track) => {
    // 記錄頻道觀看（fire-and-forget）
    apiService.recordChannelWatch(track.channel, track.thumbnail);

    // YouTube 風格：插入到下一首位置並立即播放
    dispatch(playNow(track));
  };

  const handleAddToQueue = (track: Track) => {
    dispatch(addToQueue(track));
  };

  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column',
      height: 'var(--app-dvh, 100dvh)',
      overflow: 'hidden',
      pt: isUltrawide ? 0.5 : 'max(8px, env(safe-area-inset-top, 8px))',
    }}>
      {/* 可滾動內容區 */}
      <Box ref={scrollContainerRef} sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch' }}>
      <Container maxWidth="lg" sx={{ py: isUltrawide ? 1 : 4, pb: 2 }}>
        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: isUltrawide ? 1 : 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
            <RadioButton />
          </Box>
          <Typography
            variant={isUltrawide ? "h4" : "h3"}
            component="h1"
            gutterBottom
            sx={{
              fontWeight: 700,
              background: 'linear-gradient(135deg, #C97D0A 0%, #F5A623 35%, #FFC846 65%, #F5A623 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              letterSpacing: '0.05em',
              filter: 'drop-shadow(0 0 24px rgba(245, 166, 35, 0.28))',
              pb: 0.5,
            }}
          >
            {siteTitle}
          </Typography>
          {!isUltrawide && (
            <Typography
              variant="subtitle1"
              color="text.secondary"
              sx={{
                fontFamily: '"Outfit", sans-serif',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontSize: '0.72rem',
                opacity: 0.55,
              }}
            >
              搜尋並播放 YouTube 音樂
            </Typography>
          )}
          {/* 電台收聽指示器 */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: isUltrawide ? 0.5 : 2 }}>
            <RadioIndicator />
          </Box>
        </Box>

        {/* 影片播放器 - 僅在歌詞抽屜關閉且模式為影片時顯示 */}
        {currentTrack && displayMode === 'video' && !lyricsDrawerOpen && (
          <VideoPlayer track={currentTrack} />
        )}
        {/* 搜尋列 */}
        <Box sx={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          display: 'flex',
          justifyContent: 'center',
          pt: 2,
          pb: 2,
          mb: 2,
          mx: -3,
          px: 3,
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          backgroundColor: (theme) =>
            theme.palette.mode === 'dark'
              ? 'rgba(8, 11, 18, 0.82)'
              : 'rgba(242, 237, 228, 0.82)',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}>
          <SearchBar onSearch={handleSearch} loading={loading} />
        </Box>

        {/* 錯誤訊息 */}
        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* 載入中 */}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {/* 首頁內容 */}
        <Routes>
          <Route path="/" element={
            <>
              {!loading && hasSearched ? (
                <SearchResults
                  results={searchResults}
                  onPlay={handlePlay}
                  onAddToQueue={handleAddToQueue}
                />
              ) : (
                !loading && <HomeRecommendations />
              )}
            </>
          } />
          <Route path="/playlists" element={<PlaylistSection />} />
          <Route path="/admin" element={<AdminSettings />} />
        </Routes>
      </Container>
      </Box>{/* end scrollable */}

      {/* 播放器 + 導航（不在 scrollable 內，不會被滾動影響） */}
      <AudioPlayer
        onOpenLyrics={() => setLyricsDrawerOpen(true)}
      />
      <BottomNav scrollToTop={scrollToTop} />

      {/* 全螢幕歌詞抽屜 */}
      {currentTrack && (
        <FullscreenLyrics
          open={lyricsDrawerOpen}
          onClose={() => setLyricsDrawerOpen(false)}
          track={currentTrack}
        />
      )}
    </Box>
  );
}

// App 包裝元件（提供 Router context）
function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
