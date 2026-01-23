import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Typography, CircularProgress, Button } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { RootState, AppDispatch } from '../../store';
import { fetchChannelRecommendations, loadMoreRecommendations, refreshRecommendations } from '../../store/recommendationSlice';
import { setPendingTrack, setIsPlaying, setQueue, setPlaylist } from '../../store/playerSlice';
import ChannelSection from './ChannelSection';
import type { Track } from '../../types/track.types';
import apiService from '../../services/api.service';

export default function HomeRecommendations() {
  const dispatch = useDispatch<AppDispatch>();
  const { channelRecommendations, loading, hasMore } = useSelector(
    (state: RootState) => state.recommendation
  );

  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (channelRecommendations.length === 0) {
      dispatch(fetchChannelRecommendations({ page: 0, pageSize: 5 }));
    }
  }, [dispatch, channelRecommendations.length]);

  const lastChannelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loading) return;
      if (observerRef.current) observerRef.current.disconnect();

      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore) {
          dispatch(loadMoreRecommendations());
        }
      });

      if (node) observerRef.current.observe(node);
    },
    [loading, hasMore, dispatch]
  );

  const handlePlay = async (track: Track) => {
    await apiService.recordChannelWatch(track.channel, track.thumbnail);
    dispatch(setPlaylist([track]));
    dispatch(setQueue([track]));
    dispatch(setPendingTrack(track)); // 使用 pending，等載入完成才切換 UI
    dispatch(setIsPlaying(true));
  };

  const handleRefresh = () => {
    dispatch(refreshRecommendations());
  };

  if (channelRecommendations.length === 0 && !loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          gap: 2,
        }}
      >
        <Typography variant="h5" color="text.secondary">
          開始播放音樂以獲得個人化推薦
        </Typography>
        <Typography variant="body2" color="text.secondary">
          您還沒有觀看歷史，請先搜尋並播放一些歌曲
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          為您推薦
        </Typography>
        <Button
          startIcon={<RefreshIcon />}
          onClick={handleRefresh}
          variant="outlined"
          size="small"
          disabled={loading}
        >
          刷新推薦
        </Button>
      </Box>

      {channelRecommendations.map((channel, index) => (
        <div
          key={`${channel.channelName}-${index}`}
          ref={index === channelRecommendations.length - 1 ? lastChannelRef : null}
        >
          <ChannelSection channel={channel} onPlay={handlePlay} />
        </div>
      ))}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!hasMore && channelRecommendations.length > 0 && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography variant="body2" color="text.secondary">
            已顯示所有推薦內容
          </Typography>
        </Box>
      )}
    </Box>
  );
}
