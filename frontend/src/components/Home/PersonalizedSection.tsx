import { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { Box, Typography, Card, CardMedia, CardContent, Skeleton } from '@mui/material';
import apiService from '../../services/api.service';
import { playNow } from '../../store/playerSlice';
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

export default function PersonalizedSection() {
  const dispatch = useDispatch();
  const [data, setData] = useState<PersonalizedData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiService.getPersonalizedRecommendations()
      .then(data => setData(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handlePlay = (item: PersonalizedItem) => {
    const track: Track = {
      id: item.videoId,
      videoId: item.videoId,
      title: item.title,
      channel: item.channel,
      thumbnail: item.thumbnail,
      duration: item.duration || 0,
    };
    dispatch(playNow(track));
  };

  const renderRow = (title: string, items: PersonalizedItem[]) => {
    if (!items || items.length === 0) return null;
    return (
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1, px: 1 }}>{title}</Typography>
        <Box sx={{ display: 'flex', overflowX: 'auto', gap: 1.5, px: 1, pb: 1, '&::-webkit-scrollbar': { display: 'none' } }}>
          {items.map(item => (
            <Card
              key={item.videoId}
              sx={{ minWidth: 140, maxWidth: 140, flexShrink: 0, cursor: 'pointer', borderRadius: 2 }}
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
        <Box sx={{ display: 'flex', gap: 1.5, px: 1 }}>
          {[1, 2, 3].map(i => (
            <Skeleton key={i} variant="rectangular" width={140} height={120} sx={{ borderRadius: 2, flexShrink: 0 }} />
          ))}
        </Box>
      </Box>
    );
  }

  if (!data) return null;

  return (
    <>
      {renderRow('最近播放', data.recentlyPlayed)}
      {renderRow('最常播放', data.mostPlayed)}
      {renderRow('我的收藏', data.favorites)}
    </>
  );
}
