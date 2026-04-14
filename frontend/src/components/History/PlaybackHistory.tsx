import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  Avatar,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Skeleton,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import apiService, { type PlaybackHistoryTrack } from '../../services/api.service';
import type { Track } from '../../types/track.types';

function groupByDate(tracks: PlaybackHistoryTrack[]): Record<string, PlaybackHistoryTrack[]> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = today - 86400000;
  const weekAgo = today - 7 * 86400000;

  const groups: Record<string, PlaybackHistoryTrack[]> = {};

  for (const t of tracks) {
    let label: string;
    if (t.lastPlayed >= today) label = '今天';
    else if (t.lastPlayed >= yesterday) label = '昨天';
    else if (t.lastPlayed >= weekAgo) label = '本週';
    else label = '更早';

    if (!groups[label]) groups[label] = [];
    groups[label].push(t);
  }
  return groups;
}

interface PlaybackHistoryProps {
  onPlay: (track: Track) => void;
}

export default function PlaybackHistory({ onPlay }: PlaybackHistoryProps) {
  const [tracks, setTracks] = useState<PlaybackHistoryTrack[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent && tracks.length > 0;
    if (!silent) {
      setLoading(true);
    }
    try {
      const data = await apiService.getPlaybackHistory(100);
      setTracks(data);
    } catch (error) {
      console.error('載入播放紀錄失敗:', error);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [tracks.length]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

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

  const handlePlay = (t: PlaybackHistoryTrack) => {
    const track: Track = {
      id: t.videoId,
      videoId: t.videoId,
      title: t.title,
      channel: t.channel,
      thumbnail: t.thumbnail,
      duration: t.duration,
    };
    onPlay(track);
  };

  if (loading) {
    return (
      <Box sx={{ p: 2 }}>
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} height={60} sx={{ mb: 1 }} />)}
      </Box>
    );
  }

  if (tracks.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="text.secondary">還沒有播放紀錄</Typography>
      </Box>
    );
  }

  const groups = groupByDate(tracks);
  const order = ['今天', '昨天', '本週', '更早'];

  return (
    <Box sx={{ pb: 2 }}>
      {order.map(label => {
        const items = groups[label];
        if (!items?.length) return null;
        return (
          <Box key={label}>
            <Typography
              variant="subtitle2"
              sx={{ px: 2, pt: 2, pb: 0.5, fontWeight: 600, color: 'text.secondary' }}
            >
              {label}
            </Typography>
            <List dense disablePadding>
              {items.map(t => (
                <ListItem
                  key={t.videoId}
                  onClick={() => handlePlay(t)}
                  sx={{ px: 2, cursor: 'pointer' }}
                >
                  <ListItemAvatar>
                    <Avatar variant="rounded" src={t.thumbnail} sx={{ width: 48, height: 48 }} />
                  </ListItemAvatar>
                  <ListItemText
                    primary={t.title}
                    secondary={`${t.channel} · 播放 ${t.playCount} 次`}
                    primaryTypographyProps={{ noWrap: true, variant: 'body2' }}
                    secondaryTypographyProps={{ noWrap: true, variant: 'caption' }}
                  />
                  <ListItemSecondaryAction>
                    <IconButton edge="end" size="small" onClick={() => handlePlay(t)}>
                      <PlayArrowIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          </Box>
        );
      })}
    </Box>
  );
}
