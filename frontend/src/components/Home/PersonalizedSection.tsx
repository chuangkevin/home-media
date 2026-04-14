import { useState, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { Box, Typography, Card, CardMedia, CardContent, Skeleton, useMediaQuery } from '@mui/material';
import apiService from '../../services/api.service';
import type { RootState } from '../../store';
import type { Track } from '../../types/track.types';

interface PersonalizedItem {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
}

interface PersonalizedData {
  recentlyPlayed: PersonalizedItem[];
  mostPlayed: PersonalizedItem[];
  favorites: PersonalizedItem[];
}

interface PersonalizedSectionProps {
  onPlay: (track: Track) => void;
}

export default function PersonalizedSection({ onPlay }: PersonalizedSectionProps) {
  const isDesktop = useMediaQuery('(min-width: 768px) and (pointer: fine)');
  const favoriteIds = useSelector((state: RootState) => state.favorites.favoriteIds);
  const [data, setData] = useState<PersonalizedData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent && data !== null;
    if (!silent) {
      setLoading(true);
    }
    try {
      const next = await apiService.getPersonalizedRecommendations();
      setData(next);
    } catch (error) {
      console.error('載入個人化推薦失敗:', error);
      // 前景 refresh / pull 後若請求偶發失敗，保留舊資料避免整區消失。
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [data]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (data !== null) {
      void fetchData({ silent: true });
    }
  }, [fetchData, Object.keys(favoriteIds).sort().join('|')]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
        void fetchData({ silent: true });
      }
    };
    window.addEventListener('pageshow', handleVisible);
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      window.removeEventListener('pageshow', handleVisible);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [fetchData]);

  const handlePlay = (item: PersonalizedItem) => {
    const track: Track = {
      id: item.videoId,
      videoId: item.videoId,
      title: item.title,
      channel: item.channel,
      thumbnail: item.thumbnail,
      duration: item.duration || 0,
    };
    onPlay(track);
  };

  const renderRow = (title: string, items: PersonalizedItem[], limit: number) => {
    if (!items || items.length === 0) return null;
    const visibleItems = items.slice(0, limit);
    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1, px: 1 }}>{title}</Typography>
        <Box sx={{
          display: isDesktop ? 'grid' : 'flex',
          gridTemplateColumns: isDesktop ? 'repeat(auto-fill, minmax(160px, 1fr))' : undefined,
          overflowX: isDesktop ? 'hidden' : 'auto',
          gap: 1.5,
          px: 1,
          pb: 1,
          '&::-webkit-scrollbar': { display: 'none' },
        }}>
          {visibleItems.map(item => (
            <Card
              key={item.videoId}
              sx={{
                minWidth: isDesktop ? 0 : 140,
                maxWidth: isDesktop ? 'none' : 140,
                width: isDesktop ? '100%' : undefined,
                flexShrink: 0,
                cursor: 'pointer',
                borderRadius: 2,
              }}
              onClick={() => handlePlay(item)}
            >
              <CardMedia
                component="img"
                height="80"
                image={item.thumbnail || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`}
                alt={item.title}
                sx={{ objectFit: 'cover' }}
              />
              <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                <Typography variant="caption" noWrap sx={{ fontWeight: 500, display: 'block' }}>
                  {item.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {item.channel}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Box>
      </Box>
    );
  };

  if (loading) {
    return (
      <Box sx={{ mb: 2 }}>
        <Skeleton variant="text" width={120} height={28} sx={{ mx: 1 }} />
        <Box sx={{ display: isDesktop ? 'grid' : 'flex', gridTemplateColumns: isDesktop ? 'repeat(4, minmax(0, 1fr))' : undefined, gap: 1.5, px: 1 }}>
          {[1, 2, 3].map(i => (
            <Skeleton key={i} variant="rectangular" width={isDesktop ? '100%' : 140} height={120} sx={{ borderRadius: 2, flexShrink: 0 }} />
          ))}
        </Box>
      </Box>
    );
  }

  if (!data) return null;

  return (
    <>
      {renderRow('最近播放', data.recentlyPlayed, isDesktop ? 20 : 10)}
      {renderRow('最常播放', data.mostPlayed, 10)}
      {renderRow('我的收藏', data.favorites, isDesktop ? 20 : 10)}
    </>
  );
}
