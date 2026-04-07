import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardMedia,
  Typography,
  IconButton,
  Grid,
  Chip,
  CircularProgress,
  alpha,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AddIcon from '@mui/icons-material/Add';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import CloudIcon from '@mui/icons-material/Cloud';
import StorageIcon from '@mui/icons-material/Storage';
import type { Track } from '../../types/track.types';
import { formatDuration, formatNumber, formatUploadedAt } from '../../utils/formatTime';
import AddToPlaylistMenu from '../Playlist/AddToPlaylistMenu';
import apiService from '../../services/api.service';

const PAGE_SIZE = 12;

interface SearchResultsProps {
  results: Track[];
  onPlay: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  currentTrackId?: string;
}

export default function SearchResults({
  results,
  onPlay,
  onAddToQueue,
  currentTrackId,
}: SearchResultsProps) {
  const [playlistMenuAnchor, setPlaylistMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [cacheStatus, setCacheStatus] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Reset visible count when results change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [results]);

  // 當搜尋結果變更時，檢查伺服器端快取狀態（只查可見的）
  useEffect(() => {
    if (results.length === 0) return;
    const visible = results.slice(0, visibleCount);
    const unchecked = visible.filter(r => !(r.videoId in cacheStatus));
    if (unchecked.length === 0) return;

    const videoIds = unchecked.map(r => r.videoId);
    apiService.getCacheStatusBatch(videoIds)
      .then(status => {
        const newCached: Record<string, boolean> = {};
        for (const [videoId, s] of Object.entries(status)) {
          newCached[videoId] = s.cached;
        }
        setCacheStatus(prev => ({ ...prev, ...newCached }));
      })
      .catch(() => {});
  }, [results, visibleCount]);

  // Infinite scroll: observe sentinel element
  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    if (entries[0].isIntersecting) {
      setVisibleCount(prev => Math.min(prev + PAGE_SIZE, results.length));
    }
  }, [results.length]);

  useEffect(() => {
    const observer = new IntersectionObserver(handleObserver, { rootMargin: '200px' });
    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [handleObserver]);

  const handleOpenPlaylistMenu = (event: React.MouseEvent<HTMLElement>, track: Track) => {
    setPlaylistMenuAnchor(event.currentTarget);
    setSelectedTrack(track);
  };

  const handleClosePlaylistMenu = () => {
    setPlaylistMenuAnchor(null);
    setSelectedTrack(null);
  };

  if (results.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h6" color="text.secondary">
          沒有找到結果
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          試試其他關鍵字
        </Typography>
      </Box>
    );
  }

  const visibleResults = results.slice(0, visibleCount);
  const hasMore = visibleCount < results.length;

  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        找到 {results.length} 筆結果
      </Typography>

      <Grid container spacing={2}>
        {visibleResults.map((track) => (
          <Grid item xs={12} sm={6} md={4} lg={3} key={track.id}>
            <Card
              sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1), box-shadow 0.28s cubic-bezier(0.4,0,0.2,1)',
                '&:hover': {
                  transform: 'translateY(-6px)',
                  boxShadow: '0 14px 44px rgba(0,0,0,0.42), 0 0 0 1px rgba(245,166,35,0.14)',
                },
                ...(currentTrackId === track.videoId && {
                  border: '1px solid rgba(245,166,35,0.55) !important',
                  boxShadow: '0 0 0 1px rgba(245,166,35,0.55), 0 8px 24px rgba(0,0,0,0.35)',
                }),
              }}
            >
              <Box sx={{ position: 'relative' }}>
                <CardMedia
                  component="img"
                  height="180"
                  image={track.thumbnail}
                  alt={track.title}
                  sx={{ objectFit: 'cover' }}
                />
                <Chip
                  icon={cacheStatus[track.videoId] ? <StorageIcon sx={{ fontSize: 14 }} /> : <CloudIcon sx={{ fontSize: 14 }} />}
                  label={cacheStatus[track.videoId] ? '快取' : '網路'}
                  size="small"
                  sx={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    backgroundColor: cacheStatus[track.videoId] ? 'rgba(46, 125, 50, 0.9)' : 'rgba(25, 118, 210, 0.9)',
                    color: 'white',
                    '& .MuiChip-icon': { color: 'white' },
                  }}
                />
                <Chip
                  label={formatDuration(track.duration)}
                  size="small"
                  sx={{
                    position: 'absolute',
                    bottom: 8,
                    right: 8,
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    color: 'white',
                  }}
                />
              </Box>

              <CardContent sx={{ flexGrow: 1, pb: 1 }}>
                <Typography
                  variant="subtitle1"
                  component="div"
                  sx={{
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    mb: 1,
                  }}
                >
                  {track.title}
                </Typography>

                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {track.channel}
                </Typography>

                {track.views && (
                  <Typography variant="caption" color="text.secondary">
                    {formatNumber(track.views)} 次觀看
                  </Typography>
                )}

                {track.uploadedAt && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                    上傳：{formatUploadedAt(track.uploadedAt)}
                  </Typography>
                )}
              </CardContent>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', p: 1, pt: 0 }}>
                <IconButton
                  color="primary"
                  onClick={() => onPlay(track)}
                  sx={{
                    flexGrow: 1,
                    borderRadius: 2,
                    backgroundColor: (t) => alpha(t.palette.primary.main, 0.08),
                    '&:hover': { backgroundColor: (t) => alpha(t.palette.primary.main, 0.18) },
                    transition: 'all 0.18s ease',
                  }}
                >
                  <PlayArrowIcon />
                </IconButton>
                {onAddToQueue && (
                  <IconButton
                    color="default"
                    onClick={() => onAddToQueue(track)}
                    title="加入佇列"
                  >
                    <AddIcon />
                  </IconButton>
                )}
                <IconButton
                  color="default"
                  onClick={(e) => handleOpenPlaylistMenu(e, track)}
                  title="加入播放清單"
                >
                  <PlaylistAddIcon />
                </IconButton>
              </Box>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Infinite scroll sentinel */}
      {hasMore && (
        <Box ref={loadMoreRef} sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {selectedTrack && (
        <AddToPlaylistMenu
          anchorEl={playlistMenuAnchor}
          open={Boolean(playlistMenuAnchor)}
          track={selectedTrack}
          onClose={handleClosePlaylistMenu}
        />
      )}
    </>
  );
}
