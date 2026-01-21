import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Box,
  Container,
  Typography,
  Alert,
  CircularProgress,
  Paper,
} from '@mui/material';
import SearchBar from './components/Search/SearchBar';
import SearchResults from './components/Search/SearchResults';
import AudioPlayer from './components/Player/AudioPlayer';
import DisplayModeToggle from './components/Player/DisplayModeToggle';
import VideoPlayer from './components/Player/VideoPlayer';
import LyricsView from './components/Player/LyricsView';
import VisualizerView from './components/Player/VisualizerView';
import { setCurrentTrack, setIsPlaying, addToQueue } from './store/playerSlice';
import { RootState } from './store';
import apiService from './services/api.service';
import type { Track } from './types/track.types';

function App() {
  const dispatch = useDispatch();
  const { currentTrack, isPlaying: playerIsPlaying, displayMode } = useSelector(
    (state: RootState) => state.player
  );
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async (query: string) => {
    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const results = await apiService.searchTracks(query, 20);
      setSearchResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜尋失敗，請稍後再試');
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (track: Track) => {
    dispatch(setCurrentTrack(track));
    dispatch(setIsPlaying(true));
  };

  const handleAddToQueue = (track: Track) => {
    dispatch(addToQueue(track));
  };

  return (
    <Box sx={{ minHeight: '100vh', pb: 12 }}>
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
          <Box sx={{ mb: 4 }}>
            <DisplayModeToggle />
            {displayMode === 'video' && <VideoPlayer track={currentTrack} />}
            {displayMode === 'lyrics' && <LyricsView track={currentTrack} />}
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

        {/* 初始提示 */}
        {!loading && !hasSearched && (
          <Paper
            elevation={0}
            sx={{
              p: 6,
              textAlign: 'center',
              backgroundColor: 'background.default',
            }}
          >
            <Typography variant="h5" gutterBottom>
              開始探索音樂
            </Typography>
            <Typography variant="body1" color="text.secondary" paragraph>
              在上方搜尋列輸入歌手名稱或歌曲標題
            </Typography>
            <Typography variant="body2" color="text.secondary">
              例如：「周杰倫 晴天」、「五月天」、「Taylor Swift」
            </Typography>
          </Paper>
        )}
      </Container>

      {/* 播放器（固定在底部）*/}
      <AudioPlayer />
    </Box>
  );
}

export default App;
