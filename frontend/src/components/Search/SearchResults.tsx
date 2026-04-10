import { useState, useEffect, useRef, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  Box,
  Card,
  CardContent,
  CardMedia,
  CardActionArea,
  Typography,
  IconButton,
  Grid,
  Chip,
  alpha,
  useMediaQuery,
  Menu,
  MenuItem,
  Snackbar,
  Button,
  Tabs,
  Tab,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AddIcon from '@mui/icons-material/Add';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import CloudIcon from '@mui/icons-material/Cloud';
import StorageIcon from '@mui/icons-material/Storage';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import BlockIcon from '@mui/icons-material/Block';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import PersonIcon from '@mui/icons-material/Person';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import type { Track } from '../../types/track.types';
import { formatDuration, formatNumber, formatUploadedAt } from '../../utils/formatTime';
import AddToPlaylistMenu from '../Playlist/AddToPlaylistMenu';
import apiService from '../../services/api.service';
import { RootState, AppDispatch } from '../../store';
import { blockItem, unblockItem } from '../../store/blockSlice';
import { toggleFavorite } from '../../store/favoritesSlice';

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
  const dispatch = useDispatch<AppDispatch>();
  const { items: blockedItems } = useSelector((state: RootState) => state.block);
  const favoriteIds = useSelector((state: RootState) => state.favorites.favoriteIds);
  const isUltrawide = useMediaQuery('(min-width: 1200px) and (max-height: 800px)'); // 針對 1920*720 平板
  const isDesktop = useMediaQuery('(min-width: 768px) and (pointer: fine)');
  const [playlistMenuAnchor, setPlaylistMenuAnchor] = useState<HTMLElement | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [cacheStatus, setCacheStatus] = useState<Record<string, boolean>>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [activeTab, setActiveTab] = useState(0); // 0=全部, 1=歌曲, 2=頻道, 3=播放清單
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Block context menu
  const [blockMenuAnchor, setBlockMenuAnchor] = useState<HTMLElement | null>(null);
  const [blockMenuTrack, setBlockMenuTrack] = useState<Track | null>(null);
  // Snackbar for undo
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; blockedId: number | null }>({
    open: false, message: '', blockedId: null,
  });

  const isBlocked = (videoId: string, channel: string) => {
    return blockedItems.some(b =>
      (b.type === 'song' && b.video_id === videoId) ||
      (b.type === 'channel' && b.channel_name === channel)
    );
  };

  const handleOpenBlockMenu = (event: React.MouseEvent<HTMLElement>, track: Track) => {
    event.stopPropagation();
    setBlockMenuAnchor(event.currentTarget);
    setBlockMenuTrack(track);
  };

  const handleCloseBlockMenu = () => {
    setBlockMenuAnchor(null);
    setBlockMenuTrack(null);
  };

  const handleBlockSong = async () => {
    if (!blockMenuTrack) return;
    handleCloseBlockMenu();
    const result = await dispatch(blockItem({
      type: 'song',
      videoId: blockMenuTrack.videoId,
      title: blockMenuTrack.title,
      thumbnail: blockMenuTrack.thumbnail,
    })).unwrap();
    setSnackbar({ open: true, message: `已封鎖「${blockMenuTrack.title}」`, blockedId: result.newId });
  };

  const handleBlockChannel = async () => {
    if (!blockMenuTrack) return;
    handleCloseBlockMenu();
    const result = await dispatch(blockItem({
      type: 'channel',
      channelName: blockMenuTrack.channel,
      title: blockMenuTrack.channel,
      thumbnail: blockMenuTrack.thumbnail,
    })).unwrap();
    setSnackbar({ open: true, message: `已封鎖頻道「${blockMenuTrack.channel}」`, blockedId: result.newId });
  };

  const handleUndoBlock = () => {
    if (snackbar.blockedId) {
      dispatch(unblockItem(snackbar.blockedId));
    }
    setSnackbar({ open: false, message: '', blockedId: null });
  };

  // Reset visible count and active tab when results change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setActiveTab(0); // Reset to "全部" when results change
  }, [results]);

  // Filter results based on active tab
  const filteredResults = useMemo(() => {
    if (!results || results.length === 0) return [];
    switch (activeTab) {
      case 1: // 歌曲: duration < 600s (10 min)
        return results.filter(t => (t.duration || 0) < 600);
      case 2: // 頻道: group by channel — return all, rendered differently
        return results;
      case 3: // 播放清單: placeholder — show all for now
        return results;
      default: // 全部
        return results;
    }
  }, [results, activeTab]);

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

  // 🚀 Improved Sentinel Pattern: IntersectionObserver with rootMargin for early preload
  useEffect(() => {
    if (!sentinelRef.current || visibleCount >= filteredResults.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filteredResults.length));
        }
      },
      {
        rootMargin: '0px 0px 800px 0px', // 🎯 Trigger 800px before sentinel becomes visible
        threshold: 0,
      }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [visibleCount, filteredResults.length]);

  const handleOpenPlaylistMenu = (event: React.MouseEvent<HTMLElement>, track: Track) => {
    event.stopPropagation();
    setPlaylistMenuAnchor(event.currentTarget);
    setSelectedTrack(track);
  };

  const handleClosePlaylistMenu = () => {
    setPlaylistMenuAnchor(null);
    setSelectedTrack(null);
  };

  const handleAddToQueue = (event: React.MouseEvent, track: Track) => {
    event.stopPropagation();
    onAddToQueue?.(track);
  };

  // Group by channel for the 頻道 tab
  const channelGroups = useMemo(() => {
    if (activeTab !== 2 || !results) return {};
    const groups: Record<string, typeof results> = {};
    results.forEach(t => {
      const ch = t.channel || '未知頻道';
      if (!groups[ch]) groups[ch] = [];
      groups[ch].push(t);
    });
    return groups;
  }, [results, activeTab]);

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

  const visibleResults = filteredResults.slice(0, visibleCount);

  // Render a single track card (reused in both normal and channel views)
  const renderTrackCard = (track: Track) => {
    const blocked = isBlocked(track.videoId, track.channel);
    return (
      <Card
        key={track.id}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          position: 'relative',
          transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1), box-shadow 0.28s cubic-bezier(0.4,0,0.2,1)',
          ...(!isDesktop && {
            '&:hover': {
              transform: 'translateY(-6px)',
              boxShadow: '0 14px 44px rgba(0,0,0,0.42), 0 0 0 1px rgba(245,166,35,0.14)',
            },
          }),
          ...(currentTrackId === track.videoId && {
            border: '2px solid rgba(245,166,35,0.75) !important',
            boxShadow: '0 0 0 2px rgba(245,166,35,0.75), 0 8px 32px rgba(0,0,0,0.45)',
          }),
          ...(blocked && {
            opacity: 0.4,
          }),
        }}
      >
        {/* 封鎖標記 */}
        {blocked && (
          <Box sx={{
            position: 'absolute', top: 8, right: 8, zIndex: 2,
            bgcolor: 'error.main', borderRadius: '50%', width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BlockIcon sx={{ color: 'white', fontSize: 18 }} />
          </Box>
        )}
        <CardActionArea onClick={() => onPlay(track)} sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
          <Box sx={{ position: 'relative' }}>
            <CardMedia
              component="img"
              height={isUltrawide ? "240" : "180"}
              image={track.thumbnail}
              alt={track.title}
              sx={{ objectFit: 'cover' }}
            />
            <Chip
              icon={cacheStatus[track.videoId] ? <StorageIcon sx={{ fontSize: isUltrawide ? 18 : 14 }} /> : <CloudIcon sx={{ fontSize: isUltrawide ? 18 : 14 }} />}
              label={cacheStatus[track.videoId] ? '快取' : '網路'}
              size={isUltrawide ? "medium" : "small"}
              sx={{
                position: 'absolute',
                top: 12,
                left: 12,
                backgroundColor: cacheStatus[track.videoId] ? 'rgba(46, 125, 50, 0.9)' : 'rgba(25, 118, 210, 0.9)',
                color: 'white',
                fontSize: isUltrawide ? '0.9rem' : '0.75rem',
                '& .MuiChip-icon': { color: 'white' },
              }}
            />
            <Chip
              label={formatDuration(track.duration)}
              size={isUltrawide ? "medium" : "small"}
              sx={{
                position: 'absolute',
                bottom: 12,
                right: 12,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                color: 'white',
                fontSize: isUltrawide ? '0.9rem' : '0.75rem',
              }}
            />
          </Box>

          <CardContent sx={{ flexGrow: 1, pb: 1, px: isUltrawide ? 3 : 2, pt: isUltrawide ? 2 : 1 }}>
            <Typography
              variant={isUltrawide ? "h6" : "subtitle1"}
              component="div"
              sx={{
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                mb: 1,
                lineHeight: 1.3,
              }}
            >
              {track.title}
            </Typography>

            <Typography variant={isUltrawide ? "subtitle1" : "body2"} color="text.secondary" sx={{ mb: 1.5 }}>
              {track.channel}
            </Typography>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
              {track.views !== undefined && (
                <Typography variant={isUltrawide ? "body2" : "caption"} color="text.secondary">
                  {formatNumber(track.views)} 次觀看
                </Typography>
              )}

              {track.uploadedAt && (
                <Typography
                  variant={isUltrawide ? "body2" : "caption"}
                  sx={{
                    color: 'primary.main',
                    fontWeight: 600,
                    backgroundColor: (t) => alpha(t.palette.primary.main, 0.1),
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    fontSize: isUltrawide ? '0.9rem' : 'inherit'
                  }}
                >
                  📅 {formatUploadedAt(track.uploadedAt)}
                </Typography>
              )}
            </Box>
          </CardContent>
        </CardActionArea>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', p: isUltrawide ? 2 : 1, pt: 0 }}>
          <IconButton
            color="primary"
            onClick={() => onPlay(track)}
            sx={{
              flexGrow: 1,
              borderRadius: 2,
              py: isUltrawide ? 1.5 : 1,
              backgroundColor: (t) => alpha(t.palette.primary.main, 0.08),
              '&:hover': { backgroundColor: (t) => alpha(t.palette.primary.main, 0.18) },
              transition: 'all 0.18s ease',
            }}
          >
            <PlayArrowIcon sx={{ fontSize: isUltrawide ? 32 : 24 }} />
          </IconButton>
          {onAddToQueue && (
            <IconButton
              color="default"
              onClick={(e) => handleAddToQueue(e, track)}
              title="加入佇列"
              size={isUltrawide ? "large" : "medium"}
            >
              <AddIcon sx={{ fontSize: isUltrawide ? 28 : 24 }} />
            </IconButton>
          )}
          <IconButton
            color="default"
            onClick={(e) => handleOpenPlaylistMenu(e, track)}
            title="加入播放清單"
            size={isUltrawide ? "large" : "medium"}
          >
            <PlaylistAddIcon sx={{ fontSize: isUltrawide ? 28 : 24 }} />
          </IconButton>
          <IconButton
            color="default"
            onClick={(e) => {
              e.stopPropagation();
              dispatch(toggleFavorite({
                videoId: track.videoId,
                title: track.title,
                channel: track.channel,
                thumbnail: track.thumbnail,
                duration: track.duration,
              }));
            }}
            title={favoriteIds[track.videoId] ? '取消收藏' : '收藏'}
            size={isUltrawide ? "large" : "medium"}
          >
            {favoriteIds[track.videoId]
              ? <FavoriteIcon sx={{ fontSize: isUltrawide ? 28 : 24, color: 'error.main' }} />
              : <FavoriteBorderIcon sx={{ fontSize: isUltrawide ? 28 : 24 }} />}
          </IconButton>
          <IconButton
            color="default"
            onClick={(e) => handleOpenBlockMenu(e, track)}
            title="更多選項"
            size={isUltrawide ? "large" : "medium"}
          >
            <MoreVertIcon sx={{ fontSize: isUltrawide ? 28 : 24 }} />
          </IconButton>
        </Box>
      </Card>
    );
  };

  return (
    <>
      <Typography variant={isUltrawide ? "h6" : "body2"} color="text.secondary" sx={{ mb: 1, fontWeight: isUltrawide ? 600 : 400 }}>
        找到 {results.length} 筆結果
      </Typography>

      {/* Category tabs */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 1, minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5, fontSize: '0.8rem' } }}
      >
        <Tab label="全部" />
        <Tab icon={<MusicNoteIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="歌曲" />
        <Tab icon={<PersonIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="頻道" />
        <Tab icon={<QueueMusicIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="播放清單" />
      </Tabs>

      {activeTab === 2 ? (
        // Channel grouped view
        <Box>
          {Object.entries(channelGroups).map(([channel, tracks]) => (
            <Box key={channel} sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5, px: 1 }}>
                {channel} ({tracks.length})
              </Typography>
              <Grid container spacing={isUltrawide ? 3 : 2}>
                {tracks.slice(0, 3).map(track => (
                  <Grid item xs={12} sm={6} md={4} lg={isUltrawide ? 4 : 3} key={track.id}>
                    {renderTrackCard(track)}
                  </Grid>
                ))}
              </Grid>
            </Box>
          ))}
        </Box>
      ) : (
        // Normal grid view
        <Grid container spacing={isUltrawide ? 3 : 2}>
          {visibleResults.map((track) => (
            <Grid item xs={12} sm={6} md={4} lg={isUltrawide ? 4 : 3} key={track.id}>
              {renderTrackCard(track)}
            </Grid>
          ))}
        </Grid>
      )}

      {/* 🚀 Sentinel Node: Triggers preload before scrolling to end (only for non-channel tabs) */}
      {activeTab !== 2 && visibleCount < filteredResults.length && (
        <Box
          ref={sentinelRef}
          sx={{ display: 'flex', justifyContent: 'center', py: 3, visibility: 'hidden' }}
          aria-hidden="true"
        />
      )}

      {selectedTrack && (
        <AddToPlaylistMenu
          anchorEl={playlistMenuAnchor}
          open={Boolean(playlistMenuAnchor)}
          track={selectedTrack}
          onClose={handleClosePlaylistMenu}
        />
      )}

      {/* 封鎖選單 */}
      <Menu
        anchorEl={blockMenuAnchor}
        open={Boolean(blockMenuAnchor)}
        onClose={handleCloseBlockMenu}
      >
        <MenuItem onClick={handleBlockSong}>
          <BlockIcon sx={{ mr: 1, fontSize: 20 }} /> 封鎖這首歌
        </MenuItem>
        <MenuItem onClick={handleBlockChannel}>
          <BlockIcon sx={{ mr: 1, fontSize: 20 }} /> 封鎖此頻道
        </MenuItem>
      </Menu>

      {/* 封鎖反悔 Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar({ open: false, message: '', blockedId: null })}
        message={snackbar.message}
        action={
          <Button color="warning" size="small" onClick={handleUndoBlock}>
            復原
          </Button>
        }
      />
    </>
  );
}
