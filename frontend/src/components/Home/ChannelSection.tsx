import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Typography, Avatar, Chip, Card, CardMedia, CardContent, IconButton, Skeleton, useMediaQuery } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CloudIcon from '@mui/icons-material/Cloud';
import StorageIcon from '@mui/icons-material/Storage';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DeleteIcon from '@mui/icons-material/Delete';
import { ChannelRecommendation } from '../../store/recommendationSlice';
import type { Track } from '../../types/track.types';
import { formatUploadedAt } from '../../utils/formatTime';
import apiService from '../../services/api.service';

const PAGE_SIZE = 6;
const LOAD_MORE_STEP = 6;

interface ChannelSectionProps {
  channel: ChannelRecommendation;
  onPlay: (track: Track) => void;
  onHideChannel?: (channelName: string) => void;
  cacheStatus?: Map<string, boolean>; // videoId -> isCached
  onChannelSearch?: (query: string) => void;
}

export default function ChannelSection({ channel, onPlay, onHideChannel, cacheStatus, onChannelSearch }: ChannelSectionProps) {
  const [loadedVideos, setLoadedVideos] = useState<Track[]>(channel.videos);
  const [visibleCount, setVisibleCount] = useState(Math.min(channel.videos.length, LOAD_MORE_STEP));
  const [hasMoreVideos, setHasMoreVideos] = useState(Boolean(channel.hasMoreVideos));
  const [loadingMoreVideos, setLoadingMoreVideos] = useState(false);
  const loadingMoreVideosRef = useRef(false);
  const nextFetchPageRef = useRef(Math.floor(channel.videos.length / PAGE_SIZE));
  const lastCardObserverRef = useRef<IntersectionObserver | null>(null);
  const isDesktop = useMediaQuery('(min-width: 768px) and (pointer: fine)');

  // Reset local pagination when channel changes
  useEffect(() => {
    setLoadedVideos(channel.videos);
    setVisibleCount(Math.min(channel.videos.length, LOAD_MORE_STEP));
    nextFetchPageRef.current = Math.floor(channel.videos.length / PAGE_SIZE);
    setHasMoreVideos(Boolean(channel.hasMoreVideos));
    setLoadingMoreVideos(false);
    loadingMoreVideosRef.current = false;
  }, [channel.channelName, channel.hasMoreVideos, channel.videos]);

  const loadMoreChannelVideos = useCallback(async () => {
    if (channel.type !== 'channel' || loadingMoreVideosRef.current || !hasMoreVideos) return;

    loadingMoreVideosRef.current = true;
    setLoadingMoreVideos(true);
    try {
      const nextPage = nextFetchPageRef.current;
      const response = await apiService.getChannelVideos(channel.channelName, nextPage, PAGE_SIZE);
      setLoadedVideos((prev) => {
        const merged = [...prev, ...response.videos.filter((video) => !prev.some((existing) => existing.videoId === video.videoId))];
        return merged;
      });
      nextFetchPageRef.current = nextPage + 1;
      setHasMoreVideos(response.hasMore);
      setVisibleCount((prev) => prev + LOAD_MORE_STEP);
    } catch (error) {
      console.error(`載入更多頻道影片失敗: ${channel.channelName}`, error);
    } finally {
      setLoadingMoreVideos(false);
      loadingMoreVideosRef.current = false;
    }
  }, [channel.channelName, channel.type, hasMoreVideos]);

  useEffect(() => {
    if (!isDesktop || channel.type !== 'channel') return;
    if (loadedVideos.length >= desktopLimit || !hasMoreVideos || loadingMoreVideosRef.current) return;
    void loadMoreChannelVideos();
  }, [isDesktop, channel.type, loadedVideos.length, hasMoreVideos, loadMoreChannelVideos]);

  const lastCardRef = useCallback((node: HTMLDivElement | null) => {
    if (lastCardObserverRef.current) lastCardObserverRef.current.disconnect();
    if (!node) return;
    lastCardObserverRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        if (visibleCount < loadedVideos.length) {
          setVisibleCount((prev) => Math.min(prev + LOAD_MORE_STEP, loadedVideos.length));
        } else if (channel.type === 'channel') {
          void loadMoreChannelVideos();
        }
      }
    }, { root: node.closest('[data-scroll-root]'), rootMargin: '0px 200px 0px 0px' });
    lastCardObserverRef.current.observe(node);
  }, [channel.type, loadedVideos.length, loadMoreChannelVideos, visibleCount]);

  const desktopLimit = 10;
  const renderedVideos = isDesktop
    ? loadedVideos.slice(0, desktopLimit)
    : loadedVideos.slice(0, visibleCount);

  const shouldAttachObserver = !isDesktop && (visibleCount < loadedVideos.length || (channel.type === 'channel' && hasMoreVideos));

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const isSimilarRecommendation = channel.type === 'similar' || channel.type === 'discovery';

  return (
    <Box sx={{ mb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        {isSimilarRecommendation ? (
          <Box
            sx={{
              mr: 2,
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              borderRadius: '50%',
            }}
          >
            <AutoAwesomeIcon sx={{ color: 'white', fontSize: 24 }} />
          </Box>
        ) : (
          channel.channelThumbnail && (
            <Avatar
              src={channel.channelThumbnail}
              sx={{ mr: 2, width: 40, height: 40, cursor: onChannelSearch ? 'pointer' : 'default' }}
              onClick={() => onChannelSearch?.(channel.channelName)}
            />
          )
        )}
        <Typography
          variant="h6"
          onClick={() => onChannelSearch?.(channel.channelName)}
          sx={{
            fontWeight: 600,
            fontFamily: '"Syne", sans-serif',
            letterSpacing: '0.01em',
            background: isSimilarRecommendation
              ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
              : 'inherit',
            WebkitBackgroundClip: isSimilarRecommendation ? 'text' : 'inherit',
            WebkitTextFillColor: isSimilarRecommendation ? 'transparent' : 'inherit',
            flex: 1,
            cursor: onChannelSearch ? 'pointer' : 'default',
          }}
        >
          {channel.channelName}
        </Typography>
        {!isSimilarRecommendation && (
          <Chip
            label={`${channel.watchCount} 次觀看`}
            size="small"
            sx={{ ml: 2 }}
            color="primary"
            variant="outlined"
          />
        )}
        {isSimilarRecommendation && (
          <Chip
            label="智慧推薦"
            size="small"
            sx={{
              ml: 2,
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              fontWeight: 600,
            }}
          />
        )}
        {onHideChannel && (
          <IconButton
            onClick={(event) => {
              event.stopPropagation();
              onHideChannel(channel.channelName);
            }}
            size="small"
            sx={{
              ml: 1,
              color: 'error.main',
              '&:hover': {
                backgroundColor: 'error.light',
                color: 'white',
              },
            }}
            title="隱藏此頻道"
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      <Box
        data-scroll-root
        sx={{
          display: isDesktop ? 'grid' : 'flex',
          gridTemplateColumns: isDesktop ? 'repeat(auto-fill, minmax(220px, 1fr))' : undefined,
          overflowX: isDesktop ? 'hidden' : 'auto',
          gap: 2,
          pb: 2,
          '&::-webkit-scrollbar': {
            height: 8,
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: 'rgba(0,0,0,0.1)',
            borderRadius: 4,
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: 'rgba(0,0,0,0.3)',
            borderRadius: 4,
            '&:hover': {
              backgroundColor: 'rgba(0,0,0,0.5)',
            },
          },
        }}
      >
          {renderedVideos.map((video, idx) => (
          <div
            key={video.videoId}
            ref={idx === renderedVideos.length - 1 && shouldAttachObserver ? lastCardRef : null}
            style={{ flexShrink: 0 }}
          >
          <Card
            sx={{
              minWidth: isDesktop ? 0 : { xs: 200, sm: 220, md: 240 },
              maxWidth: isDesktop ? 'none' : { xs: 200, sm: 220, md: 240 },
              width: isDesktop ? '100%' : undefined,
              flexShrink: 0,
              cursor: 'pointer',
              position: 'relative',
              transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1), box-shadow 0.28s cubic-bezier(0.4,0,0.2,1)',
              ...(!isDesktop && {
                '&:hover': {
                  transform: 'translateY(-7px) scale(1.015)',
                  boxShadow: '0 16px 48px rgba(0,0,0,0.45), 0 0 0 1px rgba(245,166,35,0.18)',
                  '& .play-overlay': { opacity: 1 },
                },
              }),
            }}
            onClick={() => onPlay(video)}
          >
            <Box sx={{ position: 'relative' }}>
              <CardMedia
                component="img"
                height="160"
                image={video.thumbnail}
                alt={video.title}
              />
              <Box
                className="play-overlay"
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  opacity: isDesktop ? 1 : 0,
                  transition: isDesktop ? 'none' : 'opacity 0.2s',
                }}
              >
                <IconButton
                  sx={{
                    backgroundColor: 'rgba(245,166,35,0.9)',
                    backdropFilter: 'blur(4px)',
                    color: '#000',
                    width: 52,
                    height: 52,
                    boxShadow: '0 0 24px rgba(245,166,35,0.5)',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      backgroundColor: '#F5A623',
                      transform: 'scale(1.1)',
                    },
                  }}
                >
                  <PlayArrowIcon sx={{ fontSize: 28 }} />
                </IconButton>
              </Box>
              <Chip
                label={formatDuration(video.duration)}
                size="small"
                sx={{
                  position: 'absolute',
                  bottom: 8,
                  right: 8,
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  color: 'white',
                  fontWeight: 600,
                }}
              />
              {/* 快取狀態指示 */}
              <Chip
                icon={cacheStatus?.get(video.videoId) ? <StorageIcon sx={{ fontSize: 14 }} /> : <CloudIcon sx={{ fontSize: 14 }} />}
                label={cacheStatus?.get(video.videoId) ? '快取' : '網路'}
                size="small"
                sx={{
                  position: 'absolute',
                  bottom: 8,
                  left: 8,
                  backgroundColor: cacheStatus?.get(video.videoId) ? 'rgba(76, 175, 80, 0.9)' : 'rgba(33, 150, 243, 0.9)',
                  color: 'white',
                  fontWeight: 500,
                  height: 22,
                  '& .MuiChip-icon': { color: 'white', marginLeft: '4px' },
                  '& .MuiChip-label': { paddingLeft: '4px', paddingRight: '8px' },
                }}
              />
            </Box>
            <CardContent sx={{ p: 1.5 }}>
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  lineHeight: 1.4,
                  minHeight: '2.8em',
                }}
              >
                {video.title}
              </Typography>
              {video.uploadedAt && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                  上傳：{formatUploadedAt(video.uploadedAt)}
                </Typography>
              )}
              {video.reason && (
                <Typography variant="caption" color="primary" sx={{ display: 'block', mt: 0.5, fontSize: '0.7rem' }}>
                  {video.reason}
                </Typography>
              )}
            </CardContent>
          </Card>
          </div>
        ))}

        {loadingMoreVideos && (
          <Box sx={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            {Array.from({ length: 2 }).map((_, i) => (
              <Box key={i} sx={{ minWidth: { xs: 200, sm: 220, md: 240 }, flexShrink: 0 }}>
                <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 1 }} />
                <Skeleton variant="text" sx={{ mt: 1 }} />
                <Skeleton variant="text" width="60%" />
              </Box>
            ))}
          </Box>
        )}
      </Box>
      {isDesktop && channel.type === 'channel' && hasMoreVideos && onChannelSearch && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -0.5, px: 0.5 }}>
          點頻道頭像或標題可直接搜尋更多 {channel.channelName} 內容
        </Typography>
      )}
    </Box>
  );
}
