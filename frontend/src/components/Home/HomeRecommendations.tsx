import { useEffect, useRef, useCallback, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Typography, CircularProgress, Button } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { RootState, AppDispatch } from '../../store';
import { fetchChannelRecommendations, loadMoreRecommendations, refreshRecommendations } from '../../store/recommendationSlice';
import { setPendingTrack, setIsPlaying, setQueue, setPlaylist } from '../../store/playerSlice';
import ChannelSection from './ChannelSection';
import type { Track } from '../../types/track.types';
import apiService from '../../services/api.service';
import audioCacheService from '../../services/audio-cache.service';
import lyricsCacheService from '../../services/lyrics-cache.service';

export default function HomeRecommendations() {
  const dispatch = useDispatch<AppDispatch>();
  const { channelRecommendations, loading, hasMore } = useSelector(
    (state: RootState) => state.recommendation
  );
  const { playlist } = useSelector((state: RootState) => state.player);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const [cacheStatus, setCacheStatus] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (channelRecommendations.length === 0) {
      dispatch(fetchChannelRecommendations({ page: 0, pageSize: 5, mixed: true }));
    }
  }, [dispatch, channelRecommendations.length]);

  // 檢查所有影片的快取狀態 + 自動預載未快取的音樂和歌詞
  useEffect(() => {
    let isActive = true; // 用於取消預載

    const checkAndPreload = async () => {
      const allVideos = channelRecommendations.flatMap(
        (channel) => channel.videos.map((v) => ({
          videoId: v.videoId,
          title: v.title,
          channel: channel.channelName,
          thumbnail: v.thumbnail,
          duration: v.duration,
        }))
      );

      if (allVideos.length === 0) return;

      try {
        // 檢查音訊快取狀態
        const allVideoIds = allVideos.map(v => v.videoId);
        const audioStatusMap = await audioCacheService.hasMany(allVideoIds);
        setCacheStatus(audioStatusMap);

        const audioCachedCount = Array.from(audioStatusMap.values()).filter(v => v).length;
        console.log(`📊 音訊快取狀態: ${audioCachedCount}/${allVideoIds.length} 已快取`);

        // 檢查歌詞快取狀態
        const lyricsStatusMap = await lyricsCacheService.hasMany(allVideoIds);
        const lyricsCachedCount = Array.from(lyricsStatusMap.values()).filter(v => v).length;
        console.log(`📝 歌詞快取狀態: ${lyricsCachedCount}/${allVideoIds.length} 已快取`);

        // 找出未快取的音訊，逐個預載
        const uncachedAudios = allVideos.filter(v => !audioStatusMap.get(v.videoId));

        if (uncachedAudios.length > 0) {
          console.log(`🔄 開始預載 ${uncachedAudios.length} 首未快取的音樂...`);

          for (const video of uncachedAudios) {
            if (!isActive) break;

            const streamUrl = apiService.getStreamUrl(video.videoId);
            try {
              await audioCacheService.preload(video.videoId, streamUrl, {
                title: video.title,
                channel: video.channel,
                thumbnail: video.thumbnail,
                duration: video.duration,
              });
              console.log(`✅ 音訊預載完成: ${video.title}`);
            } catch (err) {
              console.warn(`⚠️ 音訊預載失敗: ${video.title}`, err);
            }
          }

          if (isActive) {
            console.log(`🎉 所有推薦音樂預載完成！`);
          }
        }

        // 找出未快取的歌詞，逐個預載
        const uncachedLyrics = allVideos.filter(v => !lyricsStatusMap.get(v.videoId));

        if (uncachedLyrics.length > 0 && isActive) {
          console.log(`🔄 開始預載 ${uncachedLyrics.length} 首未快取的歌詞...`);

          for (const video of uncachedLyrics) {
            if (!isActive) break;

            try {
              const lyrics = await apiService.getLyrics(video.videoId, video.title, video.channel);
              if (lyrics) {
                await lyricsCacheService.set(video.videoId, lyrics);
                console.log(`✅ 歌詞預載完成: ${video.title}`);
              } else {
                console.log(`⏭️ 無歌詞: ${video.title}`);
              }
            } catch (err) {
              console.warn(`⚠️ 歌詞預載失敗: ${video.title}`, err);
            }
          }

          if (isActive) {
            console.log(`🎉 所有推薦歌詞預載完成！`);
          }
        }
      } catch (error) {
        console.error('檢查快取狀態失敗:', error);
      }
    };

    checkAndPreload();

    // 監聽快取更新事件，即時更新顯示狀態
    const handleCacheUpdated = (event: CustomEvent<{ videoId: string }>) => {
      const { videoId } = event.detail;
      setCacheStatus((prev) => {
        const updated = new Map(prev);
        updated.set(videoId, true);
        return updated;
      });
    };

    window.addEventListener('audio-cache-updated', handleCacheUpdated as EventListener);
    return () => {
      isActive = false; // 取消預載
      window.removeEventListener('audio-cache-updated', handleCacheUpdated as EventListener);
    };
  }, [channelRecommendations]);

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

  const handlePlay = (track: Track) => {
    // Fire-and-forget，不阻塞播放
    apiService.recordChannelWatch(track.channel, track.thumbnail);

    // 找出該頻道的所有歌曲
    const channelData = channelRecommendations.find(ch =>
      ch.videos.some(v => v.videoId === track.videoId)
    );

    if (channelData) {
      // 將該頻道的所有歌曲轉換為 Track 格式，過濾掉直播流
      const channelTracks: Track[] = channelData.videos
        .filter(v => {
          const duration = v.duration || 0;
          // 過濾掉直播流（duration 為 0 或超過 2 小時）
          if (duration === 0 || duration > 7200) {
            console.log(`⏭️ 跳過直播流: ${v.title} (${duration}s)`);
            return false;
          }
          return true;
        })
        .map(v => ({
          id: v.videoId,
          videoId: v.videoId,
          title: v.title,
          thumbnail: v.thumbnail,
          channel: channelData.channelName,
          duration: v.duration,
        }));

      // 過濾掉已經在播放清單中的歌曲
      const existingVideoIds = new Set(playlist.map(t => t.videoId));
      const newTracks = channelTracks.filter(t => !existingVideoIds.has(t.videoId));

      // Append 到現有播放清單
      const updatedPlaylist = [...playlist, ...newTracks];
      dispatch(setPlaylist(updatedPlaylist));
      dispatch(setQueue(updatedPlaylist.slice(playlist.length))); // Queue 從新加入的開始
    } else {
      // 單首歌曲，檢查是否已存在
      const existingVideoIds = new Set(playlist.map(t => t.videoId));
      if (!existingVideoIds.has(track.videoId)) {
        dispatch(setPlaylist([...playlist, track]));
        dispatch(setQueue([track]));
      }
    }

    dispatch(setPendingTrack(track)); // 使用 pending，等載入完成才切換 UI
    dispatch(setIsPlaying(true));
  };

  const handleRefresh = () => {
    dispatch(refreshRecommendations());
  };

  const handleHideChannel = async (channelName: string) => {
    try {
      await apiService.hideChannel(channelName);
      console.log(`🚫 已隱藏頻道: ${channelName}`);
      // 刷新推薦列表
      dispatch(refreshRecommendations());
    } catch (error) {
      console.error('隱藏頻道失敗:', error);
    }
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
          <ChannelSection
            channel={channel}
            onPlay={handlePlay}
            onHideChannel={handleHideChannel}
            cacheStatus={cacheStatus}
          />
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
