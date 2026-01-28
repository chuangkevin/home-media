import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Box,
  Container,
  Typography,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import SearchBar from './components/Search/SearchBar';
import SearchResults from './components/Search/SearchResults';
import AudioPlayer from './components/Player/AudioPlayer';
import DisplayModeToggle from './components/Player/DisplayModeToggle';
import VideoPlayer from './components/Player/VideoPlayer';
import FullscreenLyrics from './components/Player/FullscreenLyrics';
import VisualizerView from './components/Player/VisualizerView';
import HomeRecommendations from './components/Home/HomeRecommendations';
import PlaylistSection from './components/Playlist/PlaylistSection';
import RadioButton from './components/Radio/RadioButton';
import RadioIndicator from './components/Radio/RadioIndicator';
import { setPendingTrack, setIsPlaying, addToQueue, setPlaylist } from './store/playerSlice';
import { RootState } from './store';
import apiService from './services/api.service';
import audioCacheService from './services/audio-cache.service';
import type { Track } from './types/track.types';
import { useSocketConnection } from './hooks/useSocketConnection';
import { useRadioSync } from './hooks/useRadioSync';

function App() {
  const dispatch = useDispatch();
  const { currentTrack, displayMode } = useSelector(
    (state: RootState) => state.player
  );
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [homeTab, setHomeTab] = useState(0); // 0: 首頁推薦, 1: 播放清單
  const [lyricsDrawerOpen, setLyricsDrawerOpen] = useState(false); // 歌詞抽屜狀態

  // Socket 連線（遠端控制）
  useSocketConnection();

  // 電台同步（主播/聽眾）
  useRadioSync();

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

      // 預加載前 3 首歌曲（同時觸發後端和前端快取）
      if (results.length > 0) {
        const preloadCount = Math.min(3, results.length);
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
            audioCacheService.preload(track.videoId, streamUrl).then(() => {
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
    <Box sx={{ minHeight: '100vh', pb: 20 }}>
      <Container maxWidth="lg" sx={{ py: 4 }}>
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
            家用多媒體中心
          </Typography>
          <Typography variant="subtitle1" color="text.secondary">
            搜尋並播放 YouTube 音樂
          </Typography>
          {/* 電台收聽指示器 */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <RadioIndicator />
          </Box>
        </Box>

        {/* 播放視圖區域 */}
        {currentTrack && (
          <Box sx={{ mb: 4 }}>
            <DisplayModeToggle />
            {displayMode === 'video' && <VideoPlayer track={currentTrack} />}
            {displayMode === 'visualizer' && <VisualizerView track={currentTrack} />}
          </Box>
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

        {/* 搜尋結果 */}
        {!loading && hasSearched && (
          <SearchResults
            results={searchResults}
            onPlay={handlePlay}
            onAddToQueue={handleAddToQueue}
          />
        )}

        {/* 首頁內容（未搜尋時顯示） */}
        {!loading && !hasSearched && (
          <>
            <Tabs
              value={homeTab}
              onChange={(_, newValue) => setHomeTab(newValue)}
              centered
              sx={{ mb: 3 }}
            >
              <Tab icon={<HomeIcon />} label="首頁推薦" />
              <Tab icon={<QueueMusicIcon />} label="播放清單" />
            </Tabs>
            {homeTab === 0 && <HomeRecommendations />}
            {homeTab === 1 && <PlaylistSection />}
          </>
        )}
      </Container>

      {/* 播放器（固定在底部）*/}
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

export default App;
