import { useState, useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Box,
  Container,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import SearchBar from './components/Search/SearchBar';
import SearchResults from './components/Search/SearchResults';
import AudioPlayer from './components/Player/AudioPlayer';
import DisplayModeToggle from './components/Player/DisplayModeToggle';
import VideoPlayer from './components/Player/VideoPlayer';
import LyricsView from './components/Player/LyricsView';
import VisualizerView from './components/Player/VisualizerView';
import HomeRecommendations from './components/Home/HomeRecommendations';
import { setPendingTrack, setIsPlaying, addToQueue, setPlaylist } from './store/playerSlice';
import { RootState } from './store';
import apiService from './services/api.service';
import audioCacheService from './services/audio-cache.service';
import type { Track } from './types/track.types';
import { useSocketConnection } from './hooks/useSocketConnection';

function App() {
  const dispatch = useDispatch();
  const { currentTrack, displayMode } = useSelector(
    (state: RootState) => state.player
  );
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLyricsVisible, setIsLyricsVisible] = useState(true);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  // Socket 連線（遠端控制）
  useSocketConnection();

  // 滾動到歌詞區域（直接跳到歌詞 Paper 容器，略過專輯封面和曲目資訊）
  const scrollToLyrics = useCallback(() => {
    const lyricsTarget = document.getElementById('lyrics-scroll-target');
    if (lyricsTarget) {
      lyricsTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // 回退：滾動到整個歌詞區域
      lyricsContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

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

      // 記錄搜尋歷史
      apiService.recordSearch(query, results.length).catch(err => {
        console.warn('Failed to record search:', err);
      });

      // 設置播放列表
      dispatch(setPlaylist(results));

      // 前端快取預加載：背景預加載前 3 首歌曲
      if (results.length > 0) {
        console.log(`🔄 預加載前 ${Math.min(3, results.length)} 首歌曲...`);

        results.slice(0, 3).forEach(async (track, index) => {
          const streamUrl = apiService.getStreamUrl(track.videoId);

          // 檢查是否已快取
          const cached = await audioCacheService.get(track.videoId);
          if (cached) {
            console.log(`✅ 第 ${index + 1} 首已在快取中: ${track.title}`);
          } else {
            // 背景預載
            audioCacheService.preload(track.videoId, streamUrl).then(() => {
              console.log(`✅ 第 ${index + 1} 首預載完成: ${track.title}`);
            }).catch(err => {
              console.warn(`⚠️ 第 ${index + 1} 首預載失敗: ${track.title}`, err);
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
    // 記錄頻道觀看
    apiService.recordChannelWatch(track.channel, track.thumbnail).catch(err => {
      console.warn('Failed to record channel watch:', err);
    });

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
        </Box>

        {/* 播放視圖區域 */}
        {currentTrack && (
          <Box ref={lyricsContainerRef} sx={{ mb: 4 }}>
            <DisplayModeToggle />
            {displayMode === 'video' && <VideoPlayer track={currentTrack} />}
            {displayMode === 'lyrics' && <LyricsView track={currentTrack} onVisibilityChange={setIsLyricsVisible} />}
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

        {/* 首頁推薦 */}
        {!loading && !hasSearched && <HomeRecommendations />}
      </Container>

      {/* 播放器（固定在底部）*/}
      <AudioPlayer
        showLyricsButton={displayMode === 'lyrics' && !isLyricsVisible && !!currentTrack}
        onScrollToLyrics={scrollToLyrics}
      />
    </Box>
  );
}

export default App;
