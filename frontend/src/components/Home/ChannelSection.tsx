import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box,
  Typography,
  Avatar,
  Chip,
  Card,
  CardActionArea,
  CardMedia,
  CardContent,
  IconButton,
  Skeleton,
  useMediaQuery,
  ButtonBase,
  Button,
  Tooltip,
  Alert,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import {
  homeMediaCardSx,
  homeMediaTitleSx,
  homeMediaPlaySx,
  homeMediaShelfSx,
} from './homeMediaStyles'
import StorageIcon from '@mui/icons-material/Storage'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { ChannelRecommendation } from '../../store/recommendationSlice'
import type { Track } from '../../types/track.types'
import { formatUploadedAt } from '../../utils/formatTime'
import apiService from '../../services/api.service'

const PAGE_SIZE = 6
const LOAD_MORE_STEP = 6

interface ChannelSectionProps {
  channel: ChannelRecommendation
  onPlay: (track: Track) => void
  onHideChannel?: (channelName: string) => void
  cacheStatus?: Map<string, boolean> // videoId -> isCached
  onChannelSearch?: (query: string) => void
}

export default function ChannelSection({
  channel,
  onPlay,
  onHideChannel,
  cacheStatus,
  onChannelSearch,
}: ChannelSectionProps) {
  const [loadedVideos, setLoadedVideos] = useState<Track[]>(channel.videos)
  const [visibleCount, setVisibleCount] = useState(Math.min(channel.videos.length, LOAD_MORE_STEP))
  const [hasMoreVideos, setHasMoreVideos] = useState(Boolean(channel.hasMoreVideos))
  const [loadingMoreVideos, setLoadingMoreVideos] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const loadingMoreVideosRef = useRef(false)
  const nextFetchPageRef = useRef(Math.floor(channel.videos.length / PAGE_SIZE))
  const lastCardObserverRef = useRef<IntersectionObserver | null>(null)
  const isDesktop = useMediaQuery('(min-width: 900px)')

  // Reset local pagination when channel changes
  useEffect(() => {
    setLoadedVideos(channel.videos)
    setVisibleCount(Math.min(channel.videos.length, LOAD_MORE_STEP))
    nextFetchPageRef.current = Math.floor(channel.videos.length / PAGE_SIZE)
    setHasMoreVideos(Boolean(channel.hasMoreVideos))
    setLoadingMoreVideos(false)
    setLoadError(false)
    loadingMoreVideosRef.current = false
  }, [channel.channelName, channel.hasMoreVideos, channel.videos])

  const loadMoreChannelVideos = useCallback(async () => {
    if (channel.type !== 'channel' || loadingMoreVideosRef.current || !hasMoreVideos) return

    loadingMoreVideosRef.current = true
    setLoadingMoreVideos(true)
    setLoadError(false)
    try {
      const nextPage = nextFetchPageRef.current
      const response = await apiService.getChannelVideos(channel.channelName, nextPage, PAGE_SIZE)
      setLoadedVideos((prev) => {
        const merged = [
          ...prev,
          ...response.videos.filter(
            (video) => !prev.some((existing) => existing.videoId === video.videoId)
          ),
        ]
        return merged
      })
      nextFetchPageRef.current = nextPage + 1
      setHasMoreVideos(response.hasMore)
      setVisibleCount((prev) => prev + LOAD_MORE_STEP)
    } catch (error) {
      setLoadError(true)
      console.error(`載入更多頻道影片失敗: ${channel.channelName}`, error)
    } finally {
      setLoadingMoreVideos(false)
      loadingMoreVideosRef.current = false
    }
  }, [channel.channelName, channel.type, hasMoreVideos])

  useEffect(() => {
    if (!isDesktop || channel.type !== 'channel') return
    if (
      loadedVideos.length >= desktopLimit ||
      !hasMoreVideos ||
      loadingMoreVideosRef.current ||
      loadError
    )
      return
    void loadMoreChannelVideos()
  }, [
    isDesktop,
    channel.type,
    loadedVideos.length,
    hasMoreVideos,
    loadMoreChannelVideos,
    loadError,
  ])

  const lastCardRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (lastCardObserverRef.current) lastCardObserverRef.current.disconnect()
      if (!node) return
      lastCardObserverRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            if (visibleCount < loadedVideos.length) {
              setVisibleCount((prev) => Math.min(prev + LOAD_MORE_STEP, loadedVideos.length))
            } else if (channel.type === 'channel' && !loadError) {
              void loadMoreChannelVideos()
            }
          }
        },
        { root: node.closest('[data-scroll-root]'), rootMargin: '0px 200px 0px 0px' }
      )
      lastCardObserverRef.current.observe(node)
    },
    [channel.type, loadedVideos.length, loadMoreChannelVideos, visibleCount, loadError]
  )

  useEffect(() => () => lastCardObserverRef.current?.disconnect(), [])

  const desktopLimit = 10
  const renderedVideos = isDesktop
    ? loadedVideos.slice(0, desktopLimit)
    : loadedVideos.slice(0, visibleCount)

  const shouldAttachObserver =
    !isDesktop &&
    (visibleCount < loadedVideos.length || (channel.type === 'channel' && hasMoreVideos))

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`
  }

  const isSimilarRecommendation = channel.type === 'similar' || channel.type === 'discovery'

  return (
    <Box component="section" aria-label={channel.channelName} sx={{ mb: 4, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 2 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <ButtonBase
            onClick={() => onChannelSearch?.(channel.channelName)}
            disabled={!onChannelSearch}
            aria-label={`搜尋 ${channel.channelName}`}
            sx={{
              justifyContent: 'flex-start',
              gap: 1.5,
              width: '100%',
              minHeight: 44,
              textAlign: 'left',
              borderRadius: 1,
            }}
          >
            <Avatar
              src={isSimilarRecommendation ? undefined : channel.channelThumbnail}
              alt=""
              variant="rounded"
              sx={{
                width: 44,
                height: 44,
                flexShrink: 0,
                bgcolor: 'action.selected',
                color: 'primary.main',
              }}
            >
              <AutoAwesomeIcon />
            </Avatar>
            <Typography
              component="span"
              sx={{
                minWidth: 0,
                fontWeight: 700,
                fontSize: { xs: 18, sm: 20 },
                lineHeight: 1.5,
                overflowWrap: 'anywhere',
              }}
            >
              {channel.channelName}
            </Typography>
            {onChannelSearch && (
              <ArrowForwardIcon sx={{ fontSize: 18, flexShrink: 0, color: 'text.secondary' }} />
            )}
          </ButtonBase>
          <Chip
            label={
              isSimilarRecommendation
                ? channel.type === 'similar'
                  ? '相似藝人推薦'
                  : '探索新音樂'
                : `${channel.watchCount} 次觀看`
            }
            size="small"
            variant="outlined"
            sx={{
              ml: 7,
              mt: 1,
              height: 26,
              fontSize: 12,
              color: 'text.secondary',
              borderColor: 'divider',
            }}
          />
        </Box>
        {onHideChannel && (
          <Tooltip title="隱藏推薦">
            <IconButton
              aria-label={`隱藏推薦：${channel.channelName}`}
              onClick={() => onHideChannel(channel.channelName)}
              sx={{ width: 44, height: 44, flexShrink: 0, color: 'text.secondary' }}
            >
              <VisibilityOffOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box
        data-scroll-root
        sx={{
          ...homeMediaShelfSx,
          '&::-webkit-scrollbar': { height: 6 },
          '&::-webkit-scrollbar-thumb': { backgroundColor: 'action.selected', borderRadius: 3 },
        }}
      >
        {renderedVideos.map((video, idx) => (
          <Box
            key={video.videoId}
            ref={idx === renderedVideos.length - 1 && shouldAttachObserver ? lastCardRef : null}
            sx={{
              minWidth: 0,
              width: isDesktop ? '100%' : { xs: 192, sm: 216 },
              flexShrink: 0,
              scrollSnapAlign: 'start',
            }}
          >
            <Card sx={homeMediaCardSx}>
              <CardActionArea
                onClick={() => onPlay(video)}
                aria-label={`播放 ${video.title}，${video.channel || channel.channelName}`}
                sx={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  justifyContent: 'flex-start',
                  '&.Mui-focusVisible': { outlineOffset: -3 },
                }}
              >
                <Box sx={{ position: 'relative' }}>
                  <CardMedia
                    component="img"
                    loading="lazy"
                    image={
                      video.thumbnail || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`
                    }
                    alt=""
                    sx={{
                      width: '100%',
                      aspectRatio: '16 / 10',
                      objectFit: 'cover',
                      bgcolor: 'action.selected',
                    }}
                  />
                  <Box
                    aria-hidden="true"
                    sx={{
                      position: 'absolute',
                      bottom: 8,
                      right: 8,
                      ...homeMediaPlaySx,
                    }}
                  >
                    <PlayArrowIcon />
                  </Box>
                  <Box
                    component="span"
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      px: 0.75,
                      py: 0.25,
                      bgcolor: 'rgba(8, 11, 18, .88)',
                      color: '#fff',
                      borderRadius: 0.5,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {formatDuration(video.duration)}
                  </Box>
                  {cacheStatus?.get(video.videoId) && (
                    <Box
                      title="音訊已快取，可離線播放"
                      sx={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        display: 'grid',
                        placeItems: 'center',
                        width: 24,
                        height: 24,
                        bgcolor: 'rgba(8, 11, 18, .88)',
                        color: '#fff',
                        borderRadius: 0.5,
                      }}
                    >
                      <StorageIcon sx={{ fontSize: 16 }} />
                    </Box>
                  )}
                </Box>
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, minWidth: 0 }}>
                  <Typography variant="body2" sx={homeMediaTitleSx}>
                    {video.title}
                  </Typography>
                  <Typography
                    variant="caption"
                    component="p"
                    color="text.secondary"
                    noWrap
                    sx={{ mt: 0.5, fontSize: 12 }}
                  >
                    {video.channel || channel.channelName}
                  </Typography>
                  {video.uploadedAt && (
                    <Typography
                      variant="caption"
                      component="p"
                      color="text.secondary"
                      sx={{ mt: 0.5, fontSize: 12 }}
                    >
                      {formatUploadedAt(video.uploadedAt)}
                    </Typography>
                  )}
                  {video.reason && (
                    <Typography
                      variant="caption"
                      component="p"
                      color="text.secondary"
                      sx={{
                        mt: 1,
                        fontSize: 12,
                        lineHeight: 1.6,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {video.reason}
                    </Typography>
                  )}
                </CardContent>
              </CardActionArea>
            </Card>
          </Box>
        ))}
        {loadingMoreVideos &&
          Array.from({ length: 2 }).map((_, i) => (
            <Box
              key={`loading-${i}`}
              role="status"
              aria-label="載入更多歌曲"
              sx={{ width: isDesktop ? '100%' : { xs: 192, sm: 216 }, flexShrink: 0, minWidth: 0 }}
            >
              <Skeleton
                animation={false}
                variant="rounded"
                sx={{ aspectRatio: '16 / 10', height: 'auto' }}
              />
              <Skeleton animation={false} variant="text" sx={{ mt: 1 }} />
              <Skeleton animation={false} variant="text" width="60%" />
            </Box>
          ))}
      </Box>
      {loadError && (
        <Alert
          severity="warning"
          sx={{ mt: 2 }}
          action={
            <Button
              color="inherit"
              onClick={() => void loadMoreChannelVideos()}
              disabled={loadingMoreVideos}
              sx={{ minHeight: 44 }}
            >
              重試
            </Button>
          }
        >
          更多歌曲暫時無法載入，已保留目前內容。
        </Alert>
      )}
      {isDesktop && channel.type === 'channel' && hasMoreVideos && onChannelSearch && (
        <Button
          endIcon={<ArrowForwardIcon />}
          onClick={() => onChannelSearch(channel.channelName)}
          sx={{ mt: 1, minHeight: 44 }}
        >
          探索更多歌曲
        </Button>
      )}
    </Box>
  )
}
