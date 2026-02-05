import { useState, useEffect } from 'react';
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
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import SettingsIcon from '@mui/icons-material/Settings';
import SearchBar from './components/Search/SearchBar';
import SearchResults from './components/Search/SearchResults';
import AudioPlayer from './components/Player/AudioPlayer';
import VideoPlayer from './components/Player/VideoPlayer';
import DisplayModeToggle from './components/Player/DisplayModeToggle';
import FullscreenLyrics from './components/Player/FullscreenLyrics';
import HomeRecommendations from './components/Home/HomeRecommendations';
import PlaylistSection from './components/Playlist/PlaylistSection';
import AdminSettings from './components/Admin/AdminSettings';
import RadioButton from './components/Radio/RadioButton';
import RadioIndicator from './components/Radio/RadioIndicator';
import { setPendingTrack, setIsPlaying, addToQueue, setPlaylist } from './store/playerSlice';
import { RootState } from './store';
import apiService from './services/api.service';
import audioCacheService from './services/audio-cache.service';
import type { Track } from './types/track.types';
import { useSocketConnection } from './hooks/useSocketConnection';
import { useRadioSync } from './hooks/useRadioSync';
import { useParams } from 'react-router-dom';

// 單曲頁面元件
function TrackPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { currentTrack, playlist } = useSelector((state: RootState) => state.player);
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
        setTimeout(() => navigate('/'), 2000);
      } finally {
        setLoading(false);
      }
    };

    loadTrack();
    // 注意：不要將 currentTrack 放入依賴，否則每次歌曲切換都會觸發
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, dispatch, navigate]);

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
function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const getNavValue = () => {
    if (location.pathname === '/playlists') return '/playlists';
    if (location.pathname === '/admin') return '/admin';
    return '/';
  };

  const handleClick = (path: string) => {
    // 保持 playing 參數
    const playing = searchParams.get('playing');
    const newPath = playing ? `${path}?playing=${playing}` : path;
    navigate(newPath);
  };

  return (
    <Paper
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1200, // 高於播放器
        borderTop: '1px solid',
        borderColor: 'divider',
      }}
      elevation={8}
    >
      <BottomNavigation
        value={getNavValue()}
        showLabels
        sx={{
          height: 56, // 固定高度
        }}
      >
        <BottomNavigationAction
          label="首頁"
          value="/"
          icon={<HomeIcon />}
          onClick={() => handleClick('/')}
        />
        <BottomNavigationAction
          label="播放清單"
          value="/playlists"
          onClick={() => handleClick('/playlists')}
          icon={<QueueMusicIcon />}
        />
        <BottomNavigationAction
          label="設定"
          value="/admin"
          icon={<SettingsIcon />}
          onClick={() => handleClick('/admin')}
        />
      </BottomNavigation>
    </Paper>
  );
}

function AppContent() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentTrack, displayMode } = useSelector(
    (state: RootState) => state.player
  );
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [lyricsDrawerOpen, setLyricsDrawerOpen] = useState(false); // 歌詞抽屜狀態
  const [siteTitle, setSiteTitle] = useState('Home Media'); // 網站標題

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

  // 頁面載入/重整時，從 URL 恢復播放狀態
  useEffect(() => {
    const playingVideoId = searchParams.get('playing');
    if (playingVideoId && !currentTrack) {
      // 載入並播放該歌曲
      const loadTrack = async () => {
        try {
          const videoInfo = await apiService.getVideoInfo(playingVideoId);
          const track: Track = {
            videoId: videoInfo.videoId,
            title: videoInfo.title,
            channel: videoInfo.channel,
            thumbnail: videoInfo.thumbnail,
            duration: videoInfo.duration,
          };
          dispatch(setPlaylist([track]));
          dispatch(setPendingTrack(track));
          dispatch(setIsPlaying(true));
        } catch (err) {
          console.error('恢復播放失敗:', err);
          // 清除無效的 playing 參數
          const newParams = new URLSearchParams(searchParams);
          newParams.delete('playing');
          setSearchParams(newParams, { replace: true });
        }
      };
      loadTrack();
    }
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

  const handleSearch = async (query: string) => {
    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const results = await apiService.searchTracks(query, 20);

      // 記錄搜尋歷史（fire-and-forget）
      apiService.recordSearch(query, results.length);

      // 設置播放列表
      dispatch(setPlaylist(results));

      // 預加載第 1 首歌曲（最可能被播放，減少並發壓力）
      if (results.length > 0) {
        const preloadCount = Math.min(1, results.length);
        console.log(`🔄 預加載前 ${preloadCount} 首歌曲...`);

        results.slice(0, preloadCount).forEach(async (track, index) => {
          // 1. 觸發後端預載入（獲取 yt-dlp URL，非阻塞）
          apiService.preloadAudio(track.videoId).then(() => {
            console.log(`🔗 第 ${index + 1} 首後端 URL 預載完成: ${track.title}`);
          }).catch(err => {
            console.warn(`⚠️ 第 ${index + 1} 首後端預載失敗:`, err);
          });

          // 2. 前端快取預載入
          const streamUrl = apiService.getStreamUrl(track.videoId);
          const cached = await audioCacheService.get(track.videoId);
          if (cached) {
            console.log(`✅ 第 ${index + 1} 首已在前端快取中: ${track.title}`);
          } else {
            audioCacheService.preload(track.videoId, streamUrl, {
              title: track.title,
              channel: track.channel,
              thumbnail: track.thumbnail,
              duration: track.duration,
            }).then(() => {
              console.log(`💾 第 ${index + 1} 首前端快取完成: ${track.title}`);
            }).catch(err => {
              console.warn(`⚠️ 第 ${index + 1} 首前端快取失敗:`, err);
            });
          }
        });
      }

      setSearchResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜尋失敗，請稍後再試');
      setSearchResults([]);
      dispatch(setPlaylist([]));
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (track: Track) => {
    // 記錄頻道觀看（fire-and-forget）
    apiService.recordChannelWatch(track.channel, track.thumbnail);

    dispatch(setPendingTrack(track)); // 使用 pending，等載入完成才切換 UI
    dispatch(setIsPlaying(true));
  };

  const handleAddToQueue = (track: Track) => {
    dispatch(addToQueue(track));
  };

  return (
    <Box sx={{ minHeight: '100vh' }}>
      <Container maxWidth="lg" sx={{ py: 4, pb: '250px' }}> {/* 180px 播放器 + 56px 導航欄 + 14px 額外空間 */}
        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
            <RadioButton />
          </Box>
          <Typography
            variant="h3"
            component="h1"
            gutterBottom
            sx={{ fontWeight: 700 }}
          >
            {siteTitle}
          </Typography>
          <Typography variant="subtitle1" color="text.secondary">
            搜尋並播放 YouTube 音樂
          </Typography>
          {/* 電台收聽指示器 */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <RadioIndicator />
          </Box>
        </Box>

        {/* 影片播放器 */}
        {currentTrack && displayMode === 'video' && (
          <VideoPlayer track={currentTrack} />
        )}

        {/* 搜尋列 */}
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 4 }}>
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

      {/* 底部導航列 */}
      <BottomNav />

      {/* 播放器（固定在底部，在導航列下方）*/}
      <AudioPlayer
        onOpenLyrics={() => setLyricsDrawerOpen(true)}
      />

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
